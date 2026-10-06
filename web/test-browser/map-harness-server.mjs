// Fixture server for the map browser proofs (G21.03): serves the real web
// components, compiled in memory from TypeScript with the typescript package
// the web workspace already ships (no bundler dependency), plus tiny vendor
// shims that let the compiled modules load React's CJS production builds and
// MapLibre's UMD build directly in the browser. The provider style request
// never reaches the network in the success scenario — the test fulfils it
// from the deterministic local style below.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(WEB_ROOT, '..');

let transpiler = null;
function ts() {
  if (!transpiler) transpiler = createRequire(import.meta.url)('typescript');
  return transpiler;
}

const compileCache = new Map();
function compileModule(absPath) {
  let output = compileCache.get(absPath);
  if (output === undefined) {
    const options = {
      module: ts().ModuleKind.ESNext,
      target: ts().ScriptTarget.ES2022,
    };
    if (absPath.endsWith('.tsx')) options.jsx = ts().JsxEmit.ReactJSX;
    output = ts().transpileModule(fs.readFileSync(absPath, 'utf8'), { compilerOptions: options }).outputText;
    compileCache.set(absPath, output);
  }
  return output;
}

// Path containment for request URLs (the repo idiom: startsWith(root + sep)).
function containedPath(root, relative) {
  const resolved = path.resolve(root, relative);
  return resolved === root || resolved.startsWith(root + path.sep) ? resolved : null;
}

// Maps a request path to a source file inside web/ or (for the contracts
// bridge) the repository root; null when the path leaves both trees or the
// extension is not a servable module type.
function resolveSourceModule(requestPath) {
  if (!/\.(ts|tsx|mjs)$/.test(requestPath)) return null;
  // /src/** serves the web workspace tree; anything else resolves against
  // the repo root (the contracts/reader.mjs bridge escapes web/).
  const relative = requestPath.replace(/^\//, '').replace(/^src\//, '');
  for (const root of [WEB_ROOT, REPO_ROOT]) {
    const candidate = containedPath(root, relative);
    if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function readVendorCjs(name) {
  // name is allow-listed by the shims below (react.production.js, …), never
  // raw request data.
  const base = name.startsWith('react-dom')
    ? 'react-dom'
    : name.startsWith('scheduler')
      ? 'scheduler'
      : 'react';
  return fs.readFileSync(path.join(WEB_ROOT, 'node_modules', base, 'cjs', name), 'utf8');
}

// Tiny synchronous require shim so the browser can evaluate React's CJS
// production builds; the texts are preloaded with top-level await before any
// factory runs, so require() never needs to be async.

const VENDOR_SHIMS = {
  '/vendor/react-cjs.mjs': `
const texts = new Map();
const cache = new Map();
let ready = null;
function preload(names) {
  if (!ready) {
    ready = Promise.all(names.map(async (name) => {
      const response = await fetch('/vendor/cjs/' + name);
      if (!response.ok) throw new Error('vendor preload failed: ' + name + ' ' + response.status);
      texts.set(name, await response.text());
    }));
  }
  return ready;
}
// The factory require() is synchronous by CommonJS contract — the async
// entry only awaits the preload, the resolution itself never awaits.
function requireCjsSync(name, resolveSpec) {
  if (cache.has(name)) return cache.get(name).exports;
  const text = texts.get(name);
  if (text === undefined) throw new Error('vendor module not loaded: ' + name);
  const module = { exports: {} };
  cache.set(name, module);
  const factory = new Function('module', 'exports', 'require', text + '\\n//# sourceURL=/vendor/cjs/' + name);
  factory(module, module.exports, (spec) => {
    const resolved = resolveSpec(spec);
    if (!resolved) throw new Error('vendor require unresolved: ' + spec);
    return requireCjsSync(resolved, resolveSpec);
  });
  return module.exports;
}
export async function requireCjs(name, resolveSpec) {
  await preload([
    'react.production.js',
    'react-jsx-runtime.production.js',
    'react-dom.production.js',
    'react-dom-client.production.js',
    'scheduler.production.js',
  ]);
  return requireCjsSync(name, resolveSpec);
}
export function reactRequireMap(spec) {
  if (spec === 'react') return 'react.production.js';
  if (spec === 'react-dom') return 'react-dom.production.js';
  if (spec === 'scheduler') return 'scheduler.production.js';
  return null;
}
`,
  '/vendor/react.mjs': `
import { requireCjs, reactRequireMap } from '/vendor/react-cjs.mjs';
const react = await requireCjs('react.production.js', reactRequireMap);
export const Children = react.Children;
export const Fragment = react.Fragment;
export const createElement = react.createElement;
export const useState = react.useState;
export const useEffect = react.useEffect;
export const useLayoutEffect = react.useLayoutEffect;
export const useRef = react.useRef;
export const useCallback = react.useCallback;
export const useMemo = react.useMemo;
export const useId = react.useId;
export default react;
`,
  '/vendor/react-jsx-runtime.mjs': `
import { requireCjs, reactRequireMap } from '/vendor/react-cjs.mjs';
const runtime = await requireCjs('react-jsx-runtime.production.js', reactRequireMap);
export const jsx = runtime.jsx;
export const jsxs = runtime.jsxs;
export const Fragment = runtime.Fragment;
`,
  '/vendor/react-dom-client.mjs': `
import '/vendor/react.mjs';
import { requireCjs, reactRequireMap } from '/vendor/react-cjs.mjs';
const client = await requireCjs('react-dom-client.production.js', reactRequireMap);
export const createRoot = client.createRoot;
export const hydrateRoot = client.hydrateRoot;
export const flushSync = client.flushSync;
export default client;
`,
  // city-map.tsx dynamic-imports 'maplibre-gl'; the UMD build is already on
  // the page as window.maplibregl (loaded before the module graph). The
  // stylesheet the component imports is applied by the harness <link> below
  // (same pinned file from web/node_modules), so the import itself resolves
  // to an inert module.
  '/vendor/maplibre-gl.mjs': `
export default window.maplibregl;
`,
  '/vendor/css-shim.mjs': `
export default {};
`,
  // The component graph reaches build-time readers that import node
  // builtins; in the browser only their pure exports (localePath) are used,
  // so the builtins resolve to a chainable inert stub — callable and
  // property-safe (never thenable), enough for the readers' top-level
  // path.dirname(import.meta.url) computation, useless for real reads.
  '/vendor/node-shim.mjs': `
const inert = new Proxy(function () {}, {
  get: (target, prop) => {
    if (prop === 'then') return undefined;
    if (prop === Symbol.toPrimitive) return () => '';
    return inert;
  },
  apply: () => inert,
  construct: () => inert,
});
export default inert;
export function fileURLToPath() { return ''; }
`,
};

function harnessHtml() {
  const importMap = {
    imports: {
      react: '/vendor/react.mjs',
      'react/jsx-runtime': '/vendor/react-jsx-runtime.mjs',
      'react-dom/client': '/vendor/react-dom-client.mjs',
      'maplibre-gl': '/vendor/maplibre-gl.mjs',
      'maplibre-gl/dist/maplibre-gl.css': '/vendor/css-shim.mjs',
      ...Object.fromEntries(
        [
          'node:fs',
          'node:fs/promises',
          'node:path',
          'node:url',
          'node:assert',
          'node:assert/strict',
          'node:util',
          'node:os',
          'node:zlib',
          'node:crypto',
          'node:http',
          'node:https',
          'node:stream',
          'node:buffer',
          'node:child_process',
          'node:worker_threads',
          'node:net',
        ].map((name) => [name, '/vendor/node-shim.mjs']),
      ),
    },
  };
  return `<!doctype html>
<html lang="be">
<head>
<meta charset="utf-8">
<title>KUDY map harness</title>
<link rel="stylesheet" href="/vendor/maplibre-gl.css">
<script src="/vendor/maplibre-gl.js"></script>
<script>
  window.process = { env: { NODE_ENV: 'production' } };
  window.__pageErrors = [];
  window.addEventListener('error', (event) => { window.__pageErrors.push(String(event.message)); });
  window.addEventListener('unhandledrejection', (event) => { window.__pageErrors.push(String(event.reason)); });
</script>
<script type="importmap">${JSON.stringify(importMap)}</script>
</head>
<body>
<div id="root"></div>
<script type="module" src="/src/test-browser/map-harness.tsx"></script>
</body>
</html>
`;
}

// Deterministic provider style: no sources and no layers, so no tile, glyph
// or sprite request ever leaves the page — the map proves 'load' purely
// locally.
const STYLE_BODY = JSON.stringify({ version: 8, name: 'kudy-map-test', sources: {}, layers: [] });

const JS_CONTENT_TYPE = 'text/javascript; charset=utf-8';

export async function startMapHarnessServer() {
  const server = http.createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        const pathname = url.pathname;
        const serve = (body, type) => {
          response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
          response.end(body);
        };
        if (pathname === '/') {
          serve(harnessHtml(), 'text/html; charset=utf-8');
        } else if (pathname === '/style.json') {
          serve(STYLE_BODY, 'application/json');
        } else if (VENDOR_SHIMS[pathname]) {
          serve(VENDOR_SHIMS[pathname], JS_CONTENT_TYPE);
        } else if (pathname.startsWith('/vendor/cjs/')) {
          serve(readVendorCjs(path.basename(pathname)), JS_CONTENT_TYPE);
        } else if (pathname === '/vendor/maplibre-gl.js') {
          serve(
            fs.readFileSync(path.join(WEB_ROOT, 'node_modules', 'maplibre-gl', 'dist', 'maplibre-gl.js'), 'utf8'),
            JS_CONTENT_TYPE,
          );
        } else if (pathname === '/vendor/maplibre-gl.css') {
          serve(
            fs.readFileSync(path.join(WEB_ROOT, 'node_modules', 'maplibre-gl', 'dist', 'maplibre-gl.css'), 'utf8'),
            'text/css; charset=utf-8',
          );
        } else {
          const source = resolveSourceModule(pathname);
          if (!source) {
            response.writeHead(404, { 'content-type': 'text/plain' });
            response.end(`harness: not found ${pathname}`);
            return;
          }
          if (source.endsWith('.mjs')) serve(fs.readFileSync(source, 'utf8'), JS_CONTENT_TYPE);
          else serve(compileModule(source), JS_CONTENT_TYPE);
        }
      } catch (error) {
        response.writeHead(500, { 'content-type': 'text/plain' });
        response.end(`harness server error: ${error?.message ?? error}`);
      }
    })();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    styleBody: STYLE_BODY,
    async close() {
      // close() leaves a connection that is still sending a request (a
      // half-open browser socket, a paused Fetch) until requestTimeout,
      // which is long enough to pin the test process. closeAllConnections
      // drops those sockets so the callback runs now.
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    },
  };
}
