// WCAG 2.x relative luminance and contrast ratio — the one shared copy for
// the suite's contrast guards (design-tokens canon pairs, run-map status
// colors); a sibling variant would be a jscpd clone (implementation-rules 3).
import assert from 'node:assert/strict';

export function luminance(hex) {
  const c = hex.replace('#', '');
  assert.match(hex, /^#[0-9a-f]{6}$/i, `contrast helper expects #rrggbb, got ${hex}`);
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(fgHex, bgHex) {
  const [l1, l2] = [luminance(fgHex), luminance(bgHex)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}
