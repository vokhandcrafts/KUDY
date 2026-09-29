# G07.04 — non-finite hint values: every offending field is named

*2026-09-29 by Showboat 0.6.1*

The finite gate of `checkGuideHintValues` (`contracts/hints/guide-hints.mjs`,
issue #391) answering programmatic corrupt input — NaN/±Infinity values JSON
cannot carry. The base document is the pinned proposal
`contracts/hints/guide-hints.values.v1.json`; every scenario overrides number
fields only. No network, no clock, Node stdlib only.

One `hint-value-non-finite` diagnostic per offending field, live:

```sh
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { checkGuideHintValues } from './contracts/hints/guide-hints.mjs';
const values = JSON.parse(readFileSync('contracts/hints/guide-hints.values.v1.json', 'utf8'));
const named = (res) => res.errors.filter((e) => e.rule === 'hint-value-non-finite').map((e) => e.path);
console.log('ok base        ', checkGuideHintValues(values).ok);
console.log('radius NaN     ', JSON.stringify(named(checkGuideHintValues({ ...values, proximity_radius_m: NaN }))));
console.log('accuracy Inf   ', JSON.stringify(named(checkGuideHintValues({ ...values, accepted_accuracy_m: Infinity }))));
console.log('both non-finite', JSON.stringify(named(checkGuideHintValues({ ...values, proximity_radius_m: NaN, accepted_accuracy_m: Infinity }))));
"
```

```output
ok base         true
radius NaN      ["$.proximity_radius_m"]
accuracy Inf    ["$.accepted_accuracy_m"]
both non-finite ["$.proximity_radius_m","$.accepted_accuracy_m"]
```

Read back: the untouched proposal passes; a single non-finite field is named by
its own path in a single entry; with both number fields non-finite at once, the
answer carries two `hint-value-non-finite` entries — one per path — instead of
collapsing both violations into the first field's path, while the outcome stays
fail-closed (`ok: false` in both cases).
