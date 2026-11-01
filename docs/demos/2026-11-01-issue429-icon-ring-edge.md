# Меднае кольца — самая вонкавая палоска круга (2026-11-01)

Удакладненне ўладара таго ж дня: памечаны здымак паказаў, што замаляваная
павінна быць не толькі крэмавая ірва старой устаноўкі, а ўся зона **звонку
меднага кольца** — кольца павінна стаць самай мяжой круга. Гэта адна
геаметрычная праўка круглага экспарту без перамалёўкі: маштаб ×1.032
вакол цэнтра пасадзіў суцэльную медзь кольца (радыусы 322–331.5 px
з 1024) роўна на мяжу маскі 72/108 (радыус ≈341.5 px): да праўкі звонку
суцэльнай медзі заставалася ~10 px паўпразрыстага краю над
крэмавым фонам — тая самая светлая ірва; пасля праўкі маска разразае
суцэльную медзь, і крэмавы фон ля краю больш не бачны.

Асэты квадратнай формы (icon.png, square-foreground, legacy square webp)
не тыкаліся. Перамалёўкі малюнка няма — толькі маштаб.

Рашэнне ўладара запісанае ў рэгістр: [brand/decisions.md](../design/brand/decisions.md),
радок I1 (прынята 2026-11-01, крыніца — пазначаны здымак
`docs/testing/evidence/2026-11-01-issue429-reinstall/owner-marked-ring-position.png`).

Кадры-паказнікі: `docs/testing/evidence/2026-11-01-issue429-reinstall/`
(`ring-edge-three-way.png` — старая ўстаноўка / мінулы main / новы экспарт;
`ring-edge-owner-size.png` — параўнанне ў памеры іконкі ўладара).

<!-- showboat-id: icon-ring-edge-2026-11-01 -->

Гард-тэст інварыянту (смука медзі дасягае мяжы маскі; на экспарце да
праўкі праверка мяжы падае):

```sh
node --test --test-reporter=tap test/app-icon-bounds.test.mjs 2>&1 | grep -E '^# (tests|pass|fail) '
```

```output
# tests 3
# pass 3
# fail 0
```

Легасі круглы webp (`ic_launcher_round-*.webp`) — поўны крук: круг
займае ўвесь квадрат рэсу (без празрыстых палёў), і медзь кольца дасягае
яго краю. Праверка дэтэрмінісцкім чытаннем файла з пінаванай бібліятэкай
(у партатыўным node-стэку тэстаў дэкадэра webp няма, таму гэты інварыянт
жыве тут, а не ў `test/`; байт-ідэнтычнасць копій у native рэсах
пахавае `cmp` у дэме пераўстаноўкі):

```sh
uv run --with pillow==13.0.0 python3 - <<'PYEOF'
from PIL import Image
import math
im = Image.open('assets/kudy-icon/native-android/ic_launcher_round-xxxhdpi.webp').convert('RGBA')
px = im.load(); w = im.size[0]; c = w // 2
row = [x for x in range(w) if px[x, c][3] > 8]
bleed = (max(row) - min(row) + 1) / w
def copper(p):
    r, g, b, a = p
    return a > 200 and 120 < r < 210 and 60 < g < 130 and 20 < b < 100
n = d = 0
for i in range(1440):
    a = i / 1440 * 2 * math.pi
    x = int(round(c + 0.99 * (w / 2 - 0.5) * math.cos(a)))
    y = int(round(c + 0.99 * (w / 2 - 0.5) * math.sin(a)))
    n += 1; d += 1 if copper(px[x, y]) else 0
print(f'full-bleed={bleed:.3f} edge-copper={d / n:.3f}')
PYEOF
```

```output
full-bleed=1.000 edge-copper=0.976
```

Для натыўных рэсаў: парадак — `npx expo prebuild --platform android
--no-install`, тады `ic_launcher_round*.webp` у `android/app/src/main/res/`
паходзяць з абноўленых `assets/kudy-icon/native-android/` файлаў
(круглы foreground і круглы legacy — перагенераваныя з новага экспарту,
квадратныя — без зменаў).
