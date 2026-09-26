# Issue #324 — a published guide renders exactly once

*Showboat demo for issue #324 (judge finding on PR #318, the catalog projection), created 2026-09-27.*

<!-- showboat-id: issue-324-catalog-route-dedup -->

A malformed publication may pin two offers to one route: the discovery index
carries `offer-dup-late` (editorial_order 5) and `offer-dup-early`
(editorial_order 1), both referencing `r-1`, and the late one comes first in
the input. The catalog contract (21 §4, issue #313 AC1) renders each guide
exactly once, so `loadCatalog` must project one card — the canonically
sorted-first offer, not the first seen. The pair below is built in memory and
served through the production service:

```sh
node --experimental-strip-types --no-warnings --input-type=module -e '
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
const sha256 = async (bytes) => createHash("sha256").update(bytes).digest("hex");
const offer = (offer_id, editorial_order, title) => ({
  offer_id,
  ref: { kind: "guide", route_id: "r-1", version: "1" },
  city_id: "city-a",
  editorial_order,
  themes: [],
  localized: { title: { be: title } },
  season_recommendations: [],
  availability: { text_locales: ["be"], audio_locales: [] },
  access: "free",
});
const indexText = JSON.stringify({
  schema_version: 1, revision: "rev", city_id: "city-a", themes: [],
  offers: [offer("offer-dup-late", 5, "Дубль позні"), offer("offer-dup-early", 1, "Дубль ранні")],
  collections: [],
});
const bytes = new TextEncoder().encode(indexText);
const catalogText = JSON.stringify({
  catalog_schema_version: 1,
  routes: [{ route_id: "r-1", version: "1", locales: ["be"], layers: ["base"] }],
  discovery_index: {
    schema_version: 1, revision: "rev", path: "discovery/index.json",
    bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"),
  },
});
const loader = (p) => (p === "catalog.json" ? Promise.resolve(catalogText) : Promise.resolve(indexText));
const { loadCatalog } = await import(pathToFileURL(process.cwd() + "/services/catalog/catalogService.ts").href);
const state = await loadCatalog({ loader, sha256 }, { localePreference: ["be", "en"] }, null);
console.log("state:", state.kind, "| degraded:", state.degraded);
console.log("cards:", state.guides.map((c) => `${c.routeId}/${c.offerId}/${c.title}`).join(", "));
'
```

```output
state: ready | degraded: null
cards: r-1/offer-dup-early/Дубль ранні
```

One card, and the winner is the sorted-first offer (editorial_order 1), not
the first in the input. The proof that the demo drives the production module:
a module hook mutates the imported `catalogService.ts`, disabling the dedup
filter — the reverted projection renders both offers:

```sh
rm -rf /tmp/kudy-g0324-demo && mkdir -p /tmp/kudy-g0324-demo && node -e '
const fs = require("node:fs");
fs.writeFileSync("/tmp/kudy-g0324-demo/hooks.mjs", [
  "export async function load(url, context, next) {",
  "  const result = await next(url, context);",
  "  if (url.endsWith(\"/services/catalog/catalogService.ts\")) {",
  "    const source = String(result.source).replaceAll(\"if (seenRoutes.has(offer.route_id)) return false;\", \"if (false) return false;\");",
  "    return { format: \"module-typescript\", shortCircuit: true, source };",
  "  }",
  "  return result;",
  "}",
  "",
].join("\n"));
fs.writeFileSync("/tmp/kudy-g0324-demo/register.mjs", "import { register } from \"node:module\";\nregister(\"./hooks.mjs\", import.meta.url);\n");
console.log("mutation loader ready");
' && node --experimental-strip-types --no-warnings --import /tmp/kudy-g0324-demo/register.mjs --input-type=module -e '
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
const sha256 = async (bytes) => createHash("sha256").update(bytes).digest("hex");
const offer = (offer_id, editorial_order, title) => ({
  offer_id,
  ref: { kind: "guide", route_id: "r-1", version: "1" },
  city_id: "city-a",
  editorial_order,
  themes: [],
  localized: { title: { be: title } },
  season_recommendations: [],
  availability: { text_locales: ["be"], audio_locales: [] },
  access: "free",
});
const indexText = JSON.stringify({
  schema_version: 1, revision: "rev", city_id: "city-a", themes: [],
  offers: [offer("offer-dup-late", 5, "Дубль позні"), offer("offer-dup-early", 1, "Дубль ранні")],
  collections: [],
});
const bytes = new TextEncoder().encode(indexText);
const catalogText = JSON.stringify({
  catalog_schema_version: 1,
  routes: [{ route_id: "r-1", version: "1", locales: ["be"], layers: ["base"] }],
  discovery_index: {
    schema_version: 1, revision: "rev", path: "discovery/index.json",
    bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"),
  },
});
const loader = (p) => (p === "catalog.json" ? Promise.resolve(catalogText) : Promise.resolve(indexText));
const { loadCatalog } = await import(pathToFileURL(process.cwd() + "/services/catalog/catalogService.ts").href);
const state = await loadCatalog({ loader, sha256 }, { localePreference: ["be", "en"] }, null);
console.log("reverted cards:", state.guides.map((c) => `${c.routeId}/${c.offerId}/${c.title}`).join(", "));
console.log(state.guides.length === 2 ? "REVERTED projection renders the duplicate — the committed guard catches this class" : "guard held");
'
```

```output
mutation loader ready
reverted cards: r-1/offer-dup-early/Дубль ранні, r-1/offer-dup-late/Дубль позні
REVERTED projection renders the duplicate — the committed guard catches this class
```

The committed suite, including the negative test that fails on exactly this
revert:

```sh
node --test --experimental-strip-types "services/catalog/catalogService.test.ts" 2>/dev/null | grep -E "^ℹ (tests|pass|fail)"
```

```output
ℹ tests 16
ℹ pass 16
ℹ fail 0
```
