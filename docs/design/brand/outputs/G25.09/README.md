# G25.09 — шаблоны прэзентацыі брэнда

Кантактны ліст: [contact-sheet.html](contact-sheet.html) (+ растравы захоп [contact-sheet.png](contact-sheet.png)).
Вынік задачы: [docs/agent-tasks/results/G25.09.md](../../../../agent-tasks/results/G25.09.md).

## Змесьціва

| Файл | Шаблон | Канвы (px) |
|---|---|---|
| [store-screens.html](store-screens.html) | кампазіцыя скрыншотаў крам | play-be / play-en / play-be-run 1080×1920; as-be / as-en 1320×2868 |
| [web-intro.html](web-intro.html) | вэб-блок уводзін | web-be / web-en 1440×900; web-be-m / web-en-m 375×640 |
| [social-card.html](social-card.html) | сацыяльная картка og:image | social-be / social-en 1200×630 |
| [qr-invitation.html](qr-invitation.html) | картка-запрашэнне A6 300 dpi | qr-be / qr-en 1240×1748 |
| [qr-placeholder.svg](qr-placeholder.svg) | плейсхолдер QR (не скануецца, вадзяны знак «УЗОР») | 370×370 адзінак (29 модуляў + цішынная зона 4) |

## Перагенеравання растравых экспортаў

Кожны канва мае `id`; рэжым экспарту `?only=<id>` пакідае на старонцы адзін канва ў натуральным памеры. Здымак робіцца chromium у памеры канва (тут chromium 143.0.7737.0 на CachyOS, 12.10.2026):

```sh
cd docs/design/brand/outputs/G25.09
base=file://$PWD
chromium --headless --no-sandbox --disable-gpu --allow-file-access-from-files \
  --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1080,1920 --screenshot=store-play-be.png "$base/store-screens.html?only=play-be"
# аналагічна: play-en, play-be-run → 1080,1920; as-be, as-en → 1320,2868;
# web-be, web-en → 1440,900; web-be-m, web-en-m → 375,640;
# social-be, social-en → 1200,630; qr-be, qr-en → 1240,1748
```

Кантактны ліст захопліваецца цалкам: адкрыць `contact-sheet.html`, высіліць `scrollHeight`, потым здымак з `--window-size=1680,<scrollHeight>`.

## Што трымаць пры змене

- Радкі інтэрфейсу — даслоўна з `contracts/ui-messages/source.json` і `translations/en.json`; ідэнтыфікатары — у figcaption.
- Аўтарскі тэкст пазначаецца словам «аўтарскі» ў подпісе; новыя прапановы — праз рэестр рашэнняў (`docs/design/brand/decisions.md`), не прама ў канон.
- Правілы пашырэння тэксту — §6 кантактнага ліста; зоны трымаюць даўжэйшую мову.
- Правы і крыніцы асетаў — §7 кантактнага ліста; новы асет трапляе ў табліцу разам з запісам правоў.
