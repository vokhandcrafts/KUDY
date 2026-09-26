// G06.01.a (issue #313) — the visual values the City and Guides surfaces
// consume, copied verbatim from the single design source
// docs/design/visual-language.md («Дадатак», the machine JSON block, G06.07
// canon). Only the values these surfaces render live here; the guard in
// test/design-tokens.test.mjs pins this file to the canon — changing a value
// here without the canon turns the suite red.
export const tokens = {
  colorPaper: '#faf7f2', // color.paper — фон экрана
  colorInk: '#22262b', // color.ink — асноўны тэкст
  colorMuted: '#6b7280', // color.muted — другарадны тэкст і подпісы
  colorAccent: '#1d6b4f', // color.accent — галоўныя дзеянні
  colorAccentInk: '#ffffff', // color.accent-ink — тэкст на акцэнце
  colorCard: '#ffffff', // color.card — фон картак
  colorLine: '#d8d2c6', // color.line — межы картак
  colorBadgePaid: '#fdf1d7', // color.badge.paid
  colorBadgeFree: '#e7f2ec', // color.badge.free
  colorBadgeMixed: '#ece7f8', // color.badge.mixed
  colorNoticeBg: '#fdf1d7', // color.notice.bg
  colorNoticeBorder: '#e6c98c', // color.notice.border
  colorErrorBg: '#fdeaea', // color.error.bg
  colorErrorBorder: '#e0a2a2', // color.error.border
  radiusBase: 10, // radius.base
  radiusPill: 99, // radius.pill
  spaceS: 8, // space.s
  spaceM: 12, // space.m
  spaceL: 16, // space.l
  fontBaseSize: 16, // font.base-size
  fontWeightStrong: '600', // font.weight-strong
} as const;
