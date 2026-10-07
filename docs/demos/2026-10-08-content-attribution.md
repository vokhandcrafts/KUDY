# Атрыбуцыя на вэб-старонках гідаў

*2026-10-07T23:33:34Z by Showboat 0.6.1*
<!-- showboat-id: 492a521e-d9f6-4087-a37f-ed26114df954 -->

Сінтэтычны гід паказвае крыніцу і крэдыт публічнага аўдыё. Закрытая кропка захоўвае толькі прэв’ю і спасылку на правілы. Каманда перазбірае статычны сайт і правярае ўсе старонкі гідаў і кропак.

```bash
set -e
npm --prefix web run build >/dev/null 2>&1
node --experimental-strip-types web/scripts/scan-rendered.ts 2>/dev/null
python3 - <<'PY'
from pathlib import Path
out = Path('web/out')
pages = [p for p in out.rglob('*.html') if '/guides/' in ('/' + p.relative_to(out).as_posix())]
assert pages
for page in pages:
    html = page.read_text()
    assert 'data-content-attribution="true"' in html, page
    locale = page.relative_to(out).parts[0]
    href = '/usage-rules' if locale == 'guides' else f'/{locale}/usage-rules'
    assert f'href="{href}"' in html, page
free = (out / 'guides/demo-route-a1/stops/stop-1.html').read_text()
locked = (out / 'guides/demo-route-a1/stops/stop-2.html').read_text()
assert 'Дэма-крыніца: сінтэтычны архіў' in free
assert 'CC0 1.0' not in free
assert 'Сінтэтычны дэма-тан' in free
assert 'Сінтэтычны дэма-тан' not in locked
print('content-page attribution and public-only credits: OK')
PY

```

```output
rendered-output scan: clean
document-language scan: clean
content-attribution scan: clean
content-page attribution and public-only credits: OK
```
