# APR-02 — Android без непатрэбнага доступу

*2026-10-18T01:24:41Z by Showboat 0.6.1*
<!-- showboat-id: 8d407481-0b06-4fad-acf2-3e08a5046fc6 -->

Генератар Expo стварае забароны для мікрафона, агульнага сховішча і накладанняў паверх іншых праграм. Залежнасці не могуць вярнуць гэтыя дазволы падчас зліцця маніфестаў. Сэрвіс запісу выключаны; дазволы прайгравання і лакацыі захаваныя. Праверка ніжэй паўтарае сапраўдную генерацыю без запісу натыўных файлаў і без чытання .env.

Таксама забаронены непатрэбныя VIBRATE, USE_BIOMETRIC і USE_FINGERPRINT. KUDY не выклікае вібрацыю і не ўключае requireAuthentication у SecureStore; шыфраванае сховішча не патрабуе гэтых дазволаў.

```powershell
$result = node --test --test-reporter=tap test/android-release-manifest.test.mjs
$code = $LASTEXITCODE
[Console]::Write((($result | Where-Object { $_ -match '^# (tests |pass |fail |skipped )|^not ok' }) -join [char]10) + [char]10)
exit $code

```

```output
# tests 10
# pass 10
# fail 0
# skipped 0
```
