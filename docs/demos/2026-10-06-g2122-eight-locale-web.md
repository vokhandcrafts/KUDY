# G21.22 — вэб-маршруты васьмі моў інтэрфейсу, незалежныя ад нарацыі

*2026-10-06 by Showboat 0.6.1*

G21.22 (issue #554): вэб выпускае ўсе восем UI-моваў з рэестру і паказвае толькі тэкст, фактычна апублікаваны на выбранай мове. Дэма правярае ланцуг на рэальным дэма-фіксуры (тэкст be/en/uk, аўдыё be/en — змешаная даступнасць супраць васьмі UI-моваў): гейт слоўнікаў, пусты каталог fr пры поўным хроме, уласныя словы uk, адмова карупцыі «абвешчана, але адсутнічае», метададзеныя па факце тэксту (noindex недаступнага стану, canonical/hreflang толькі апублікаваных моваў), sitemap-фільтр і пусты urlset пры неапублікаваным паходжанні:

```python
import os, pathlib, subprocess, sys, tempfile
sys.stdout.reconfigure(encoding='utf-8', newline='\n')

SCRIPT = '''
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = '__ROOT__';

// The shipped-catalogue gate: fails on any hand edit or revert of the
// source/translation data behind the eight UI languages.
const gate = spawnSync(process.execPath, ['--experimental-strip-types', 'tools/i18n/check-messages.mjs'], { cwd: ROOT, encoding: 'utf8' });
console.log('gate_exit=' + gate.status);

// The demo fixture, built by the real packager, with the interim catalog.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'g2122-demo-'));
const build = spawnSync(process.execPath, ['tools/build-bundle/build-bundle.mjs', '--in', 'fixtures/content/demo-route', '--out', tmp], { cwd: ROOT, encoding: 'utf8' });
console.log('packager_exit=' + build.status);
const publicRoot = path.join(tmp, 'public');
const { deriveInterimCatalog } = await import(pathToFileURL(path.join(ROOT, 'contracts/interim-catalog.mjs')));
fs.writeFileSync(path.join(publicRoot, 'catalog.json'), JSON.stringify(deriveInterimCatalog(publicRoot)));

const site = await import(pathToFileURL(path.join(ROOT, 'web/lib/content/site.ts')));
const cards = await import(pathToFileURL(path.join(ROOT, 'web/lib/content/cards.ts')));
const sitemap = await import(pathToFileURL(path.join(ROOT, 'web/lib/content/sitemap.ts')));

// Criterion 2: a locale without published text yields a valid localized
// empty catalogue — chrome complete, no cards, no content fallback.
const fr = site.readSiteCatalogPage(publicRoot, 'fr');
console.log('fr_cards=' + fr.cards.length);
console.log('fr_map=' + fr.mapHref);

// Criterion 3: the published text locale renders its own words behind the
// locale prefix.
const uk = site.readSiteCatalogPage(publicRoot, 'uk');
console.log('uk_title=' + uk.cards[0].title);
console.log('uk_href=' + uk.cards[0].href);

// The gate the guide/stop pages read: the offer's declared text locales.
console.log('text_locales=' + site.routeTextLocales(publicRoot, 'demo-route-a1').join(','));

// Criterion 4: canonical/hreflang follow actual published text; the
// unavailable-language state is noindex.
const frMeta = cards.guidePageMetadata(publicRoot, 'fr', 'demo-route-a1');
const frRobots = frMeta.robots && frMeta.robots.index === false && frMeta.robots.follow === true ? 'noindex,follow' : 'missing';
console.log('fr_robots=' + frRobots);
console.log('fr_title_set=' + (typeof frMeta.title === 'string' && frMeta.title.length > 0));
const ukMeta = cards.guidePageMetadata(publicRoot, 'uk', 'demo-route-a1');
console.log('uk_canonical=' + ukMeta.alternates.canonical);
console.log('uk_hreflang=' + Object.keys(ukMeta.alternates.languages).join(','));

// Criterion 4: the sitemap advertises chrome in every UI locale but guide
// and stop pages only for published text locales; an unpublished site
// origin emits nothing.
const paths = sitemap.sitemapPaths(publicRoot);
console.log('paths=' + paths.length);
console.log('fr_guides=' + paths.filter((p) => p.startsWith('/fr/guides')).length);
console.log('uk_stop_in=' + paths.includes('/uk/guides/demo-route-a1/stops/stop-1'));
console.log('sitemap_unpublished=' + sitemap.buildSitemapEntries(publicRoot).length);

// Criterion 2 negative: declared-but-missing text fails distinctly — the
// exact-localized read throws the named rejection, the build dies loudly.
const catalog = JSON.parse(fs.readFileSync(path.join(publicRoot, 'catalog.json'), 'utf8'));
const indexFile = path.join(publicRoot, ...catalog.discovery_index.path.split('/'));
const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
index.offers[0].availability.text_locales.push('fr');
fs.writeFileSync(indexFile, JSON.stringify(index));
let corrupt = 'none';
try { site.readSiteCatalogPage(publicRoot, 'fr'); } catch (error) { corrupt = error.code; }
console.log('corrupt_code=' + corrupt);
'''

root = pathlib.Path.cwd()
env = dict(os.environ)
env['LD_LIBRARY_PATH'] = str(pathlib.Path.home() / '.local' / 'lib')
tmp = pathlib.Path(tempfile.mkdtemp())
(tmp / 'report.mjs').write_text(SCRIPT.replace('__ROOT__', root.as_posix()), encoding='utf-8')
run = subprocess.run(
    ['node', '--experimental-strip-types', str(tmp / 'report.mjs')],
    capture_output=True, text=True, encoding='utf-8', cwd=root, env=env, timeout=180)
assert run.returncode == 0, run.stdout[-2000:] + run.stderr[-2000:]
report = {}
for line in run.stdout.strip().splitlines():
    key, _, value = line.partition('=')
    report[key] = value
assert report['gate_exit'] == '0', report
assert report['packager_exit'] == '0', report
assert report['fr_cards'] == '0', report
assert report['fr_map'] == '/fr/map', report
assert report['uk_title'] == 'Демо-гід: сукняний двір', report
assert report['uk_href'] == '/uk/guides/demo-route-a1', report
assert report['text_locales'] == 'be,en,uk', report
assert report['fr_robots'] == 'noindex,follow', report
assert report['fr_title_set'] == 'true', report
assert report['uk_canonical'] == '/uk/guides/demo-route-a1', report
assert report['uk_hreflang'] == 'be,en,uk', report
assert report['paths'] == '41', report
assert report['fr_guides'] == '0', report
assert report['uk_stop_in'] == 'true', report
assert report['sitemap_unpublished'] == '0', report
assert report['corrupt_code'] == 'unknown-locale', report
print(run.stdout.strip())
```

```output
gate_exit=0
packager_exit=0
fr_cards=0
fr_map=/fr/map
uk_title=Демо-гід: сукняний двір
uk_href=/uk/guides/demo-route-a1
text_locales=be,en,uk
fr_robots=noindex,follow
fr_title_set=true
uk_canonical=/uk/guides/demo-route-a1
uk_hreflang=be,en,uk
paths=41
fr_guides=0
uk_stop_in=true
sitemap_unpublished=0
corrupt_code=unknown-locale
```

Другі блок — паводзінны proof пераключальніка моваў на рэальным экспарце (заўвага рэвью [key: missing-language-switch-test]): поўная вэб-зборка, потым rendered-старонкі. На каталогу fr — усе восем саманазваў і марк бягучай; на fr-старонцы недаступнага гіда — пераключальнік трымае той самы шлях гіда для семі іншых моваў (там яны даступныя або даюць свой лакаляваны стан), а бягучая fr не спасылаецца сама на сябе:

```python
import os, pathlib, re, subprocess, sys
sys.stdout.reconfigure(encoding='utf-8', newline='\n')

root = pathlib.Path.cwd()
env = dict(os.environ)
env['LD_LIBRARY_PATH'] = str(pathlib.Path.home() / '.local' / 'lib')
build = subprocess.run(
    ['npm', 'run', 'build'], cwd=root / 'web', env=env,
    capture_output=True, text=True, encoding='utf-8', timeout=420)
assert build.returncode == 0, build.stdout[-2000:] + build.stderr[-2000:]
out = root / 'web' / 'out'

names = ['Беларуская', 'English', 'Українська', 'Deutsch', 'Español', 'Français', 'Čeština', 'Svenska']
catalog = (out / 'fr.html').read_text(encoding='utf-8')
present = sum(1 for name in names if name in catalog)
assert present == 8, present
assert 'aria-current="page"' in catalog

guide = (out / 'fr' / 'guides' / 'demo-route-a1.html').read_text(encoding='utf-8')
prefixed = ['/en/guides/demo-route-a1', '/uk/guides/demo-route-a1', '/de/guides/demo-route-a1',
            '/es/guides/demo-route-a1', '/cs/guides/demo-route-a1', '/sv/guides/demo-route-a1']
kept = sum(1 for href in prefixed if f'href="{href}"' in guide)
assert kept == len(prefixed), kept
assert 'href="/guides/demo-route-a1"' in guide  # be renders without a prefix
assert 'href="/fr/guides/demo-route-a1"' not in guide  # the current locale never links to itself

print('build_exit=0')
print('switch_names=' + str(present))
print('switch_current=marked')
print('switch_paths_kept=' + str(kept + 1))
print('switch_self_link=none')
```

```output
build_exit=0
switch_names=8
switch_current=marked
switch_paths_kept=7
switch_self_link=none
```
