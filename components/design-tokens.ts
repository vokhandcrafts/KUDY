// G06.01.a (issue #313) — the visual values the City and Guides surfaces
// consume, copied verbatim from the single design source
// docs/design/visual-language.md («Дадатак», the machine JSON block, G06.07
// canon). Only the values these surfaces render live here; the guard in
// test/design-tokens.test.mjs pins this file to the canon — changing a value
// here without the canon turns the suite red. Lives in components/, not
// app/: expo-router treats every app/ file as a route (issue #339).
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
  colorMap: '#eef3ee', // color.map — фон мапы Побач і Run
  colorMarkerPlaying: '#b3331f', // color.marker.playing
  colorMarkerPlayed: '#1d6b4f', // color.marker.played
  colorMarkerAvailable: '#8a610e', // color.marker.available
  colorMarkerPending: '#646c77', // color.marker.pending
  colorMarkerLocked: '#67707a', // color.marker.locked
  radiusBase: 10, // radius.base
  markerSize: 34, // size.marker — дыяметр маркера кропкі
  radiusPill: 99, // radius.pill
  spaceS: 8, // space.s
  spaceM: 12, // space.m
  spaceL: 16, // space.l
  dialogMaxWidth: 400, // dialog.max-width — дыялог, гл. visual-language §4
  fontBaseSize: 16, // font.base-size
  fontTitleSize: 18, // font.size-title — памер загалоўка экрана
  fontWeightStrong: '600', // font.weight-strong
  fontBigTextFactor: 1.25, // font.big-text-factor
  // G06.10.b (issue #402) — the font-family mirror: the named per-weight
  // faces the @expo-google-fonts packages export, one family per weight
  // (React Native cannot pick a weight inside a family — the Android
  // workaround). Values are not the canon CSS chains verbatim; the guard
  // pins each entry to its licensed canon family instead (test
  // design-tokens.test.mjs, G06.10.b).
  fontFamilyUi: 'GolosText_400Regular', // font.family-ui
  fontFamilyUiStrong: 'GolosText_600SemiBold', // font.family-ui
  fontFamilyDisplay: 'Alegreya_600SemiBold', // font.family-display
  fontFamilyDragon: 'Caveat_400Regular', // font.family-dragon
} as const;
