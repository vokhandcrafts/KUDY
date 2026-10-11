# G21.50 — release-флаг адкрытых лакаляў: рэзолвер, фолбэк захаванага выбару, вэб-маршруты

*2026-10-11T09:55:43Z by Showboat 0.6.1*
<!-- showboat-id: g2150-locale-release-flag -->

Адзін build/deploy-уваход `EXPO_PUBLIC_OPEN_UI_LOCALES` кіруе тым, які код бачны
карыстальніку: замарожаная васьмёрка застаецца адкрытай пры любым стане флага,
зарэгістраваны-закрыты код схаваны ўсюды, пакуль флаг яго не naming. Сінтэтычны
`zz` у блоках 1–2 грае першага гейтаванага спажыўцу (`zh` прылятае з #669/#670).

Рэзолвер: адсутны/сметны флаг адкрывае нішто; флаг дадае толькі
зарэгістраваны-поўны код.

```bash
node --experimental-strip-types --input-type=module -e "
const m = await import('./contracts/ui-locales.ts');
const nine = [...m.COMPLETE_UI_LOCALES, 'zz'];
console.log('flag absent  ->', m.releaseOpenUiLocales(undefined, nine).join(','));
console.log('flag corrupt ->', m.releaseOpenUiLocales('bogus,,ru', nine).join(','));
console.log('flag opens zz->', m.releaseOpenUiLocales('zz', nine).join(','));
console.log('prod today   ->', m.releaseOpenUiLocales('zh').join(','));
" 2>/dev/null
```

```output
flag absent  -> be,en,uk,de,es,fr,cs,sv
flag corrupt -> be,en,uk,de,es,fr,cs,sv
flag opens zz-> be,en,uk,de,es,fr,cs,sv,zz
prod today   -> be,en,uk,de,es,fr,cs,sv
```

Захаваны выбар закрытага коду: сесія падае на `be`, durable радок не
перазапісваецца, `set` закрытага — названая памылка `ui-locale-closed`;
адкрыццё флагам аднаўляе выбар.

```bash
node --experimental-strip-types --input-type=module -e "
const { createUiLocaleStore } = await import('./controllers/uiLocaleStore.ts');
const closed = createUiLocaleStore({ read: () => 'en', write: () => {} }, ['be', 'uk']);
console.log('saved en, en closed -> session:', closed.current());
let overwrote = false;
const row = createUiLocaleStore({ read: () => 'en', write: () => { overwrote = true; } }, ['be', 'uk']);
console.log('durable row overwritten:', overwrote);
const opened = createUiLocaleStore({ read: () => 'en', write: () => {} }, ['be', 'en', 'uk']);
console.log('flag opened en -> session:', opened.current());
try { closed.set('en'); } catch (e) { console.log('set en while closed ->', e.rule); }
" 2>/dev/null
```

```output
saved en, en closed -> session: be
durable row overwritten: false
flag opened en -> session: en
set en while closed -> ui-locale-closed
```

Вэб-маршрутнае мноства выводзіцца ад таго ж рэзолвера на білдзе: флаг са
сметнымі/незарэгістраванымі токенамі раўназначны адсутнаму.

```bash
EXPO_PUBLIC_OPEN_UI_LOCALES="bogus,,ru" node --experimental-strip-types --input-type=module -e "
const { uiLocales } = await import('./web/lib/i18n/index.ts');
console.log('web route set under flag:', uiLocales.join(','));
" 2>/dev/null
```

```output
web route set under flag: be,en,uk,de,es,fr,cs,sv
```
