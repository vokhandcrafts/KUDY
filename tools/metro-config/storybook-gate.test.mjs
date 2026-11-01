// DQ-13 (issue #914) — guards for the bundle-level Storybook gate
// (implementation-rules 1 and 7: the withStorybook wiring in metro.config.js
// is configuration-as-code; removing it turns tests here red). The wrapper's
// disabled branch is pinned against a fake config (the real chain needs a
// live Metro resolution context); the wiring itself is asserted from source.
// The end-to-end production proof (expo export + bundle grep) runs in the
// shipping session and is captured in docs/agent-tasks/results/DQ-13.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const RN_STORYBOOK_DIR = join(root, 'node_modules', '@storybook', 'react-native');
const ENTRY_REQUEST = '../.rnstorybook/root';
const WALK_SKIP = new Set(['node_modules', '.git', '.rnstorybook', 'android', 'ios', '.zcode', '.mimosa', '.scratch', '.voka']);

const configLines = (file) =>
  readFileSync(join(root, file), 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

test('guard: with enabled=false withStorybook empties every @storybook/* request', () => {
  const { withStorybook } = require(join(RN_STORYBOOK_DIR, 'dist/metro/withStorybook.js'));
  const plain = { type: 'sourceFile', filePath: join(root, 'plain.ts') };
  const disabled = withStorybook(
    { resolver: { resolveRequest: () => plain } },
    { enabled: false, configPath: join(root, '.rnstorybook') },
  );
  for (const request of ['@storybook/react-native', 'storybook/internal/csf', '@storybook/addon-ondevice-controls']) {
    assert.deepEqual(
      disabled.resolver.resolveRequest({}, request, 'android'),
      { type: 'empty' },
      `${request} must resolve to an empty module outside the flag`,
    );
  }
});

test('guard: with enabled=false the non-index entry falls to the empty branch — no stub module', () => {
  const { withStorybook } = require(join(RN_STORYBOOK_DIR, 'dist/metro/withStorybook.js'));
  const configPath = join(root, '.rnstorybook');
  const entryPath = join(configPath, 'root.tsx');
  const disabled = withStorybook(
    {
      resolver: {
        resolveRequest: (context, moduleName) => ({
          type: 'sourceFile',
          filePath: moduleName === ENTRY_REQUEST
            ? entryPath
            : moduleName === './storybook.requires'
              ? join(configPath, 'storybook.requires.ts')
              : join(root, 'plain.ts'),
        }),
      },
    },
    { enabled: false, configPath },
  );
  // root.tsx sits inside the config dir and is not an index.* entry, so the
  // wrapper's {type: "empty"} branch answers — the package stub (two files
  // of @storybook/react-native) never enters the bundle.
  assert.deepEqual(
    disabled.resolver.resolveRequest({}, ENTRY_REQUEST, 'android'),
    { type: 'empty' },
    'the entry must resolve to an empty module outside the flag',
  );
  const insideConfig = disabled.resolver.resolveRequest({}, './storybook.requires', 'android');
  assert.deepEqual(insideConfig, { type: 'empty' }, 'no file of the config dir may enter the disabled graph');
  const plain = disabled.resolver.resolveRequest({}, '../components/guide-card', 'android');
  assert.equal(plain.filePath, join(root, 'plain.ts'), 'unrelated requests pass through unchanged');
});

test('guard: metro.config.js wires the official wrapper, the env flag and telemetry off', () => {
  const source = readFileSync(join(root, 'metro.config.js'), 'utf8');
  assert.match(source, /require\("@storybook\/react-native\/metro\/withStorybook"\)/, 'the official wrapper must be wired');
  assert.match(source, /enabled:\s*process\.env\.EXPO_PUBLIC_STORYBOOK === "1"/, 'the env flag must gate the wrapper');
  assert.match(source, /process\.env\.STORYBOOK_DISABLE_TELEMETRY = "1"/, 'the metro-side telemetry event must be disabled');
  assert.doesNotMatch(configLines('metro.config.js'), /websockets|experimental_mcp/, 'no remote-control option may be wired');
});

test('guard: app/storybook.tsx is the only import site of the entry specifier', () => {
  const hits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || WALK_SKIP.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name) && readFileSync(path, 'utf8').includes(ENTRY_REQUEST)) {
        hits.push(relative(root, path));
      }
    }
  };
  for (const dir of ['app', 'components', 'controllers', 'core', 'services', 'test']) walk(join(root, dir));
  assert.deepEqual(hits, [join('app', 'storybook.tsx')]);
});

test('guard: telemetry off; the websockets remote and the MCP server are never enabled', () => {
  const main = configLines(join('.rnstorybook', 'main.ts'));
  const index = configLines(join('.rnstorybook', 'root.tsx'));
  assert.match(main, /disableTelemetry:\s*true/);
  assert.match(index, /enableWebsockets:\s*false/);
  assert.doesNotMatch(index, /host:\s|port:\s|secured:\s|deepLink/, 'no server address may be configured');
  assert.doesNotMatch(main + index, /\bmcp\b/i);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.deepEqual(
    Object.keys(pkg.scripts).filter((key) => key.includes('storybook')),
    ['storybook:generate'],
    'only the story registration generator exists — no Storybook CLI server script',
  );
});

test('guard: the device UI reads the single stories source — no second state list', () => {
  const main = configLines(join('.rnstorybook', 'main.ts'));
  assert.match(main, /\.\.\/components\/\*\*\/\*\.stories\.tsx/, 'the glob must read the components stories');
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || WALK_SKIP.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.stories\.[cm]?[jt]sx?$/.test(entry.name)) found.push(relative(root, path));
    }
  };
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && !WALK_SKIP.has(entry.name)) walk(join(root, entry.name));
  }
  assert.deepEqual(found, [join('components', 'guide-card.stories.tsx')]);
});
