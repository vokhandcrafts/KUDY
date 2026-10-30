# MAP-07 — адсутны bounds дае дакументаваны RangeError

*2026-10-30T00:01:54Z by Showboat 0.6.1*
<!-- showboat-id: ab4bce1e-c964-436a-957f-2b717023faac -->

Суддзя знайшоў на PR #895 (issue #898): README MAP-07 абяцае RangeError для
няправільнай канфігурацыі да пачатку жэста, але адсутны або null `bounds`
падаў на дэструктывізацыю да finite-праверкі і кінаў TypeError. Пасля
выпраўлення абодва выпадкі дыягнастуюцца тым самым дакументаваным RangeError.

```bash
node --input-type=module -e "import('./spikes/MAP-07-tap-drag/tap-drag.mjs').then(({createTapDrag}) => { for (const opts of [{ position: { x: 10, y: 10 }, size: { width: 40, height: 40 } }, { position: { x: 10, y: 10 }, size: { width: 40, height: 40 }, bounds: null }]) { try { createTapDrag(opts); console.log('NO THROW'); } catch (e) { console.log(e.constructor.name + ': ' + e.message); } } })"
```

```output
RangeError: A fragment must fit inside finite safe bounds with a positive drag threshold
RangeError: A fragment must fit inside finite safe bounds with a positive drag threshold
```

Ахоўны negative-тэст у edge-cases.test.mjs мае выпадкі `{ bounds: undefined }` і `{ bounds: null }`: вяртанне простай дэструктывізацыі ў tap-drag.mjs рве яго (TypeError не ёсць RangeError).

```bash
set -o pipefail; node --test --test-reporter=spec spikes/MAP-07-tap-drag/edge-cases.test.mjs | sed -E "s/ \([0-9.]+ms\)//g; /duration_ms/d"
```

```output
✔ Final pointer sample, foreign events and returned snapshots cannot create accidental taps
✔ Invalid geometry is diagnosed; non-finite movement cannot corrupt the position
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
