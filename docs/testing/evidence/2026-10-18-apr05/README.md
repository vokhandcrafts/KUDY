# Скрыншоты APR-05

Дата: 2026-10-18. Крыніца: лакальны release APK `by.kudy.app.demo` з `EXPO_PUBLIC_DEMO_MODE=1`. Першая матрыца знята з APK SHA-256 `b21b55d846bf3ea82cc494c41c0cb34c094bf79418c5895f452abbaf44ccec96`; дадатковыя здымкі вузкага акна — з перасабранага пасля рэв’ю APK SHA-256 `46f207121a6beb787d3e6b33c2962a063f8bc09b9276566971483c3197b9909d`. Змест дэманстрацыйны, без асабістых даных. Android 15 (API 35) — AVD `kudy-apr05-api35`, 1080×2400; Android 16 (API 36) — AVD `kudy-e2e`, штатны памер 1080×2340. Абодва запускаліся асобна.

Назвы файлаў маюць выгляд `android{15|16}-{gesture|threebutton}-{screen}.png`. `gesture` азначае `navigation_mode=2`, `threebutton` — `navigation_mode=0`. Рэжым трох кнопак усталёўваўся камандай `adb shell cmd overlay enable-exclusive --user 0 --category com.android.internal.systemui.navbar.threebutton` з перазапускам эмулятара.

Скрыншоты зроблены камандай `adb exec-out screencap -p` пасля загрузкі кожнага экрана. `preview` адкрываўся з каталога або спасылкай `kudy://route/e2e-free-guide`; `run` — пасля загрузкі і націску «Пачаць»; `dialog` — праз «Завяршыць прагулку»; `error` — спасылкай `kudy://route/no-such-route`. Матрыца і высновы — у [выніках APR-05](../../../agent-tasks/results/APR-05.md).

Пасля рэв’ю на Android 16 у трохкнопкавым рэжыме акно зменшана да 720×1280 пры 360 dpi. `android16-threebutton-720x1280-preview-start.png` паказвае пачатак спісу, `android16-threebutton-720x1280-preview-end.png` — той жа preview пасля двух пракрутак да апошняй карткі і кнопкі «Загрузіць» над сістэмнай панэллю. Другі APK утрымлівае і дадатковыя адступы Place, Feedback, Collection, Discovery; для іх правераны render-тэсты, асобных прыладавых здымкаў гэтых экранаў няма.
