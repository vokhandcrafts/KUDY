// DQ-12 (#922): one reusable preflight of an HTML mockup against the design
// canon — the general form of what test/map-05-specimen.test.mjs pins for
// MAP-05 (design-QA spec §2 row 1, §7 stage 1). Four rules per mockup:
// colors come from canon token values of the matching theme, the declared
// contrast pairs hold, state names stay in the accepted sets, and the
// interface text references existing localization keys.
//
// The canon (docs/design/visual-language.md machine block) is the only
// source of values — this module restates none of them (implementation-rules
// 2). A mockup joins the canon by convention: a `section.theme[data-theme="…"]`
// CSS block holds the custom properties, `data-state="…"` attributes name the
// rendered states, `data-key="…"` attributes name the localization keys.
// A mockup whose component carries accepted states outside the canon lists
// (MAP-05's drag interactions, accepted with #883 in
// docs/agent-tasks/results/MAP-05.md) passes them via `states`; the canon
// lists are always allowed on top.
//
// Findings are diagnostics, never thrown errors (implementation-rules 14):
// corrupt mockup markup, an empty catalog or a malformed color produce a
// finding naming the rule, not a crashed suite.
import { contrast } from './wcag-contrast.mjs';

const HEX = /^#[0-9a-f]{6}$/i;

// The union of the canon machine state lists — the default allowed set for
// `data-state` values. The canon §7 introduces no new names; these are the
// accepted ones (markers, state families, delivery, session, dragon).
export function canonStateNames(canon) {
  return [...new Set([
    ...(canon.markers ?? []),
    ...(canon.stateFamilies ?? []),
    ...(canon.deliveryStates ?? []),
    ...(canon.sessionStates ?? []),
    ...(canon.dragonStates ?? []),
  ])];
}

// Canon value of a token for the theme: the dark palette overrides the light
// token when it declares the token, otherwise the light value applies
// (canon darkTheme; same resolution as the darkValue idiom in
// test/design-dark-theme.test.mjs).
function tokenValue(canon, theme, token) {
  if (theme === 'dark' && canon.darkTheme?.tokens && token in canon.darkTheme.tokens) {
    return canon.darkTheme.tokens[token];
  }
  return canon.tokens?.[token]?.value;
}

function extractThemeVars(html, theme) {
  const block = html.match(new RegExp('section\\.theme\\[data-theme="' + theme + '"\\]\\s*\\{([^}]+)\\}'));
  if (!block) return null;
  return Object.fromEntries([...block[1].matchAll(/(--[a-z-]+)\s*:\s*([^;}]+)/g)]
    .map(([, name, value]) => [name, value.trim().toLowerCase()]));
}

// Runs every rule over one mockup and returns the findings:
// [{ rule, message }] with `rule` one of theme-block, canon-token, contrast,
// state, localization-key. Options:
//   label         — mockup name used in every message
//   canon         — loadCanon() result (required)
//   strings       — records of contracts/ui-messages/source.json (optional)
//   themes        — theme blocks the mockup must declare (default light+dark)
//   mappings      — { cssVarName: 'color.accent' } without the `--` prefix
//   contrastPairs — [{ fg, bg, min?, why? }] over the mapping variable names
//   states        — extra accepted state names on top of the canon lists
//   keys          — localization keys to verify; default: every data-key value
export function checkMockup(html, options = {}) {
  const findings = [];
  const add = (rule, message) => findings.push({ rule, message });
  const label = options.label ?? 'mockup';

  const canon = options.canon;
  if (!canon || typeof canon !== 'object' || !canon.tokens) {
    add('canon', `${label}: canon is not loaded — pass loadCanon() from test/design-canon.mjs`);
    return findings;
  }
  if (typeof html !== 'string' || html.trim() === '') {
    add('html', `${label}: mockup HTML is empty`);
    return findings;
  }

  const themes = options.themes ?? ['light', 'dark'];
  const mappings = options.mappings ?? {};
  const allowed = new Set([...canonStateNames(canon), ...(options.states ?? [])]);

  const themeVars = {};
  for (const theme of themes) {
    themeVars[theme] = extractThemeVars(html, theme);
    if (!themeVars[theme]) {
      add('theme-block', `${label} [${theme}]: no section.theme[data-theme="${theme}"] token block`);
    }
  }

  for (const theme of themes) {
    const vars = themeVars[theme];
    if (!vars) continue;
    for (const [name, token] of Object.entries(mappings)) {
      const expected = tokenValue(canon, theme, token);
      if (typeof expected !== 'string') {
        add('canon-token', `${label} [${theme}]: ${token} is not a canon token`);
        continue;
      }
      const actual = vars['--' + name];
      if (actual === undefined) {
        add('canon-token', `${label} [${theme}]: --${name} is missing, canon ${token} is ${expected}`);
      } else if (!HEX.test(actual)) {
        add('canon-token', `${label} [${theme}]: --${name} is "${actual}", expected a #rrggbb value of canon ${token} (${expected})`);
      } else if (actual !== expected.toLowerCase()) {
        add('canon-token', `${label} [${theme}]: --${name} is ${actual}, canon ${token} is ${expected.toLowerCase()}`);
      }
    }
    for (const pair of options.contrastPairs ?? []) {
      const min = pair.min ?? 4.5;
      const why = pair.why ? ' (' + pair.why + ')' : '';
      const fg = vars['--' + pair.fg];
      const bg = vars['--' + pair.bg];
      if (fg === undefined || bg === undefined) {
        const missing = fg === undefined ? pair.fg : pair.bg;
        add('contrast', `${label} [${theme}]: contrast pair ${pair.fg}/${pair.bg} cannot be checked — the theme block has no --${missing}${why}`);
        continue;
      }
      if (!HEX.test(fg) || !HEX.test(bg)) {
        add('contrast', `${label} [${theme}]: contrast pair ${pair.fg}/${pair.bg} cannot be measured — a value is not #rrggbb${why}`);
        continue;
      }
      const ratio = contrast(fg, bg);
      if (ratio < min) {
        add('contrast', `${label} [${theme}]: contrast ${pair.fg}/${pair.bg} ${ratio.toFixed(2)}:1 < ${min}:1${why}`);
      }
    }
  }

  const rendered = [...html.matchAll(/data-state="([^"]+)"/g)].map((match) => match[1]);
  for (const state of new Set(rendered)) {
    if (!allowed.has(state)) {
      add('state', `${label}: unknown state "${state}" — allowed: ${[...allowed].join(', ')}`);
    }
  }

  const keys = options.keys ?? [...new Set([...html.matchAll(/data-key="([^"]+)"/g)].map((match) => match[1]))];
  if (keys.length > 0) {
    if (!Array.isArray(options.strings)) {
      add('localization-key', `${label}: localization catalog is not readable — pass the records of contracts/ui-messages/source.json`);
    } else {
      const ids = new Set(options.strings
        .map((entry) => entry?.id)
        .filter((id) => typeof id === 'string'));
      for (const key of keys) {
        if (!ids.has(key)) {
          add('localization-key', `${label}: localization key "${key}" does not exist in the catalog`);
        }
      }
    }
  }

  return findings;
}

// One line per finding, ready to paste into an assert message.
export function formatFindings(findings) {
  return findings.map((finding) => `[${finding.rule}] ${finding.message}`).join('\n');
}
