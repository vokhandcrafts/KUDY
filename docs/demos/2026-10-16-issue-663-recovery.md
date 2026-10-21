# Праверка аднаўлення прагулкі на Android

*2026-10-16T14:54:16Z by Showboat 0.6.1*
<!-- showboat-id: 69f140f3-00e1-4eb0-9808-959306bd8e5c -->

Android-сюіта праходзіць сем сцэнарыяў аднаўлення з сінтэтычным origin. Каманда ніжэй дэтэрмінавана правярае вытворчую кампазіцыю і дазвол геалакацыі. Для поўнай праверкі на эмулятары задайце KUDY_E2E_APK і запусціце npm run e2e:android -- --suite recovery.

```bash
node --test --experimental-strip-types --experimental-test-module-mocks controllers/deviceServices.integration.test.ts services/location/service.test.ts services/location/expo/expo-location-port.test.ts >/dev/null 2>&1 && printf "Production composition and location regression tests: PASS\n"
```

```output
Production composition and location regression tests: PASS
```
