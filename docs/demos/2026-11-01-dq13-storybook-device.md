# DQ-13 — Storybook React Native on the device (issue #914)

Дата: 2026-11-01. Клон: `KUDY-dq13`, галіна `zcode/914`, база main `81c3d109`.

Крытэр доказу з issue: «The production-bundle test; Showboat demo with a
screenshot of Storybook on the emulator».

## Блок 1 — гейт бандла на механізме wrapper-а (правіла 1: зняцце wiring чырваніць)

```bash
node --test tools/metro-config/storybook-gate.test.mjs 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

```output
ℹ tests 6
ℹ pass 6
ℹ fail 0
```

Рэвэрт-экспэрымэнт 2026-11-01 у сэсіі змены: выдаленне з
`metro.config.js` выкліку `withStorybook` (трымтачны рэдакт той самай
сэсіі) даваў `pass 5 / fail 1` у `guard: metro.config.js wires the official
wrapper…`; аднаўленне — `pass 10 / fail 0`.

## Блок 2 — production-бандл не ўтрымлівае модуляў Storybook

Лічыцца толькі спіс модуляў (`sources` source-map) — не тэксты
`sourcesContent`, дзе каментары `app/storybook.tsx` згадваюць
`@storybook/*`:

```bash
rm -rf /tmp/kudy-dq13-prodbundle
npx expo export --platform android --source-maps --output-dir /tmp/kudy-dq13-prodbundle >/dev/null 2>&1
MAP=$(find /tmp/kudy-dq13-prodbundle -name "*.map" | head -1)
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(sum('@storybook/' in s for s in d['sources']))" "$MAP"
```

```output
0
```

У source-map бандла `@storybook/` сустракаецца 0 разоў — ніводны модуль
пакетаў Storybook не ўваходзіць у release-граф (route-абалонка
`app/storybook.tsx` і stories DQ-02 — не модулі Storybook).

## Блок 3 — гісторыі DQ-02 у Storybook на эмульятары

Працэдура жывой праверкі: эмулятар kudy-test (1080×2400), dev-client APK,
сабраны з натыўнымі пірамі Storybook (`react-native-gesture-handler`,
`@react-native-community/slider`, `@react-native-community/datetimepicker`);
Metro з `EXPO_PUBLIC_STORYBOOK=1` (`npm run storybook:generate` упісаны ў
postinstall і ідзе пры старце Metro праз withStorybook), `adb reverse tcp:8081
tcp:8081`, запуск `kudy://expo-development-client/?url=exp%3A%2F%2F10.0.2.2%3A8081`,
далей deep-лінк `kudy:///storybook`. Скрыншоты ў `.scratch/dq13/` (untracked,
як у дэмах 2026-09-28-issue347 / 2026-09-28-issue348):

- `story-free.png` — гісторыя `free` рэндэрыцца ў Storybook, ніжні бар
  «components/guide-card/free»;
- `story-list.png` — навігацыя «COMPONENTS → Guide Card»: free, paid, mixed,
  long-title (усы чатыры іменаваныя гісторыі з
  `components/guide-card.stories.tsx`, адзіная крыніца стан — другога спісу
  няма);
- `controls-panel.png` — панэль «Controls» з рэдагаваным args-аб'ектам
  `card` (JSON-кантрол) — прагляд/праўка стану на тэлефоне.

## Крытэры забеспячэння

- Крывыя каманды з блокаў 1–2 — дэтэрмінаваныя на фінальным HEAD; выхад
  залежыць толькі ад змесціва рэпазітара.
- Блок 3 — жывыя скрыншоты, непасрэдна выкананыя ў сесіі змены
  2026-11-01 на эмулятары kudy-test (Android API 35, dev-client, Metro
  порта 8081 клону KUDY-dq13).
