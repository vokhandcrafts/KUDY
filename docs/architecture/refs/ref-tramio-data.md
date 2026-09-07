# Tramio — data / content / backend layer (reference analysis)

Scope: `packages/storage`, `packages/clients`, `packages/crypto-service`, `packages/backend`,
`packages/authoring` (+ `AUTHORING.md`), `fixtures/`, plus the pack-build script in `tooling/`.
Source is AGPL-3.0 — nothing below is quoted; identifiers and behaviour are described in
paraphrase only.

---

## What it does

### 1. Content bundle format

A **Content_Bundle** is a directory identified by `bundleId` + semver `version`. It has an
*authored* layer (what a human writes) and a *lock* layer (what the machine derives and signs).

**Authored files** (all at the pack root):

| File | Purpose |
|---|---|
| `manifest.json` | Bundle identity + metadata |
| `route.json` | Geometry: polyline + ordered stops + deviation corridor |
| `pois.json` | The triggerable content units |
| `narratives/{poiId}.{lang}.md` | Prose per POI per language, with YAML frontmatter |
| `standby/{trackId}.json` | Optional filler tracks declared in the manifest |
| `tiles/{z}/{x}/{y}.pbf` | Optional offline vector map tiles |

**`manifest.json` fields.** `bundleId` (lowercase kebab pattern), `version` (semver),
`city` = `{ id, country }` (country is ISO 3166-1 alpha-2), `transitLine` =
`{ gtfsRouteId, direction, agency, mode }` where mode ∈ {bus, tram}, `languages[]`
(ISO 639-1, unique, ≥1), `defaultLanguage`, `minAppVersion` (semver), `deadReckoning` =
`{ permitted, maxLeadSeconds }`, `standbyTracks[]` (ids), `attribution[]` (a discriminated
union: either an OSM marker or a Creative-Commons entry that *requires* both a license id and
a non-empty attribution string), `checksumAlgorithm` (pinned to sha256), optional `validUntil`
(content expiry date) and `notes`. `additionalProperties` is false everywhere — unknown fields
are a hard error, not silently ignored.

**`route.json` fields.** `bundleId` (must equal the manifest's), `polyline` as an array of
`[lat, lng]` tuples (≥2), `stops[]` each `{ id, coord, name?, gtfsStopId?, scheduledOffsetSec? }`,
and `deviationCorridorMeters` (how far off the line counts as "the vehicle left the route").
The two GTFS fields are deliberately **optional at default/strict validation and required only
at `--release`** — a route drawn from OpenStreetMap platforms genuinely has no feed ids or
timings, and the design refuses to fill them with nulls or invented values.

**`pois.json` fields.** `pois[]`, each: `id`, `category` ∈ {landmark, architectural-detail,
trivia}, `priority` (integer 0..1000, used when geofences overlap), `geometry` (a union of
`circle` = center + radiusMeters, or `polygon` = ≥3 vertices), optional `directionFilter`
(`alongRoute` + an angular tolerance ≤180° — so a northbound POI does not fire on the
southbound run), `dwellSec` (minimum 3), optional `deferrable`, optional `drPermitted`,
`tier` ∈ {free, time_pass, token_unlock, b2b}, optional `tone` ∈ {standard, memorial},
`narratives` (a language-keyed map of ISO-639-1 code → bundle-relative markdown path),
optional `audio` (same key shape → pre-rendered audio path), and optional `deeperLayers[]`
(`{ id, tier, narrative }` — an "extra depth" unlock attached to the same POI).

**Localization** is first-class but simple: language is a *map key*, not a separate bundle.
One pack carries all its languages. The invariants are (a) `defaultLanguage` must appear in
`languages`, (b) every POI must have a narrative in the default language, and (c) every
language present in `audio` must also be present in `narratives` — i.e. **pre-rendered audio
may never ship without a transcript** (accessibility + captions). File naming convention is
`{poiId}.{lang}.md`, but the actual path is read from the map, not inferred.

**The lock file** (`MANIFEST.lock.json`) is machine-generated at build time. Payload:
`bundleId`, `version`, `createdAt` (ISO-8601), and `assets[]` where each asset is
`{ path, sizeBytes, sha256, protected?, encryption? }`. `encryption` (when a `protected` asset
is present) names a scheme string, a chunk size, and a *plaintext* SHA-256 — the pack layer
verifies the ciphertext hash, the crypto layer verifies the plaintext hash after decrypt.
Note the two hashes exist precisely so neither layer has to trust the other.

**Versioning.** There is no in-place mutation of a version. `bundleId@version` is the unit:
new content = new version directory, new lock, new signature, new catalog entry. On disk this
maps to `{docs}/packs/{bundleId}/{version}/`, which makes "two versions installed at once"
representable and rollback trivial.

### 2. Content signing

**What is signed:** the *canonical* JSON encoding (recursively sorted object keys) of the lock
payload — not the file bytes as written. Both signer and verifier recompute the canonical form,
so pretty-printing, key order and whitespace on the wire are irrelevant.

**With what:** Ed25519. The backend keeps two long-lived key classes with namespaced key ids:
a `cat-…` key signs catalog listings, manifest locks, GTFS pointers and moderation state; an
`ent-…` key signs entitlement payloads. Separating the classes means an entitlement key
rotation never invalidates installed packs.

**Wire shape:** every JSON endpoint returns a three-field envelope — payload, base64url
signature, and key id. The same envelope shape is reused for the manifest lock, and a
*detached* variant (signature + kid only, over the same canonical bytes) is exposed at its
own URL and advertised on asset responses via a custom response header.

**When verification happens — three times, deliberately:**
1. **At download start.** Fetch the signed lock, verify the signature, then verify that the
   payload's `bundleId`/`version` match what was actually requested. This second check blocks
   a swap attack where a valid signature over a *different* pack is served.
2. **At promotion.** Every asset's streaming SHA-256 must match its lock entry before the
   staged directory is renamed into place; the signed envelope itself is written into the pack
   as a control file under a dot-directory (`.tramio/MANIFEST.lock.signed.json`) *before*
   activation. That control file is intentionally not listed inside its own asset list.
3. **At every load.** Opening a pack re-reads the persisted envelope, re-verifies the
   signature, re-checks identity, then re-verifies size + SHA-256 of `manifest.json`,
   `route.json`, `pois.json`, every referenced narrative, and every declared audio file —
   before parsing any of them. Content is never parsed before it is authenticated.

**Failure taxonomy.** A dedicated integrity error carries a machine-readable kind —
missing-lock, signature, identity-mismatch, hash-mismatch, size-mismatch, asset-missing,
asset-not-listed, invalid-content — plus a user-safe message that never leaks a filesystem
path. Two subtleties worth stealing: `asset-not-listed` (a file referenced by `pois.json` but
absent from the signed asset list is an integrity failure, not a shrug), and `invalid-content`
(bytes are authentic but structurally broken → that's a *publisher* bug, not tampering, and is
reported differently). Packs installed before signing existed fail closed with `missing-lock`
and must be re-downloaded — no legacy grandfathering.

**Key distribution.** The public key (DER SubjectPublicKeyInfo, base64url) plus its kid live in
a checked-in JSON fixture that the client imports at build time — i.e. **pinned in the binary**,
not fetched. The private half is gitignored and lives only on the build machine. Production is
expected to inject a different, rotated public key through build-time env config rather than
shipping the dev fixture. Verification optionally asserts an expected kid; a kid mismatch is
reported as a plain signature failure, so kid policy has exactly one owner.

**Platform reality:** React Native has no WebCrypto SHA-512, so the Ed25519 library must be
wired with an explicit hash implementation, and the raw 32-byte key is sliced off the tail of
the SPKI blob rather than parsed with a full ASN.1 decoder.

**Verdict on Ed25519 pack signing vs signed short-TTL CDN URLs** — see the reject section below.

### 3. Local storage (SQLite + filesystem)

**Filesystem layout.** `{documentDirectory}/packs/{bundleId}/{version}/` is the live pack.
`{version}.staging/` (sibling) is the in-progress download. `{version}.backup/` is the
previous install kept alive during promotion. `bundleId` and `version` are validated as safe
single path segments on the way in (no separators, no dot-dot, no NUL) — path traversal is
refused at construction, not at use.

**SQLite tables** (one file, schema applied idempotently, with a `_schema_version` row so
later migrations can layer instead of wiping):

| Table | Key | Purpose |
|---|---|---|
| `pack_progress` | (bundle_id, version, asset_path) | Per-asset download state: `status` ∈ pending/partial/complete (TEXT + CHECK, since SQLite has no enums), `bytes_total`, `bytes_done`, verified `sha256` or null, `updated_at`. Secondary index on (bundle, version, status) so "how many assets are still missing" is a cheap query. This table *is* the resume ledger. |
| `entitlement_cache` | device_id | The last signed entitlement payload verbatim, plus `expiry_utc` and `fetched_at_utc`. Stored signed so it can be re-verified offline. |
| `lru_access` | (bundle_id, version) | `last_access_utc` + `bytes_used` per installed pack; indexed on last access. Drives eviction and the storage-management screen. |
| `moderation_snapshot` | snapshot_id | Last fetched "which segments are disabled" payload + fetch time. Lets a bad segment be silenced offline. |
| `device_id` | pinned id = 1 | Single-row table (CHECK forces one row) holding the anonymous device UUID + creation time. |
| `license_tokens` | (bundle_id, bundle_version) | Cached per-pack license token (a compact JWS stored as BLOB) with its expiry + fetch time. |

**Download lifecycle.** Downloads for the same `bundleId@version` serialize through a keyed
mutex; different packs run concurrently. The sequence: recover → fetch signed lock → verify
signature → verify identity → sort assets into a dependency order → create staging dir → seed
`pack_progress` rows → per asset: if the staged file already hashes correctly, mark complete and
skip; otherwise mark partial, stream bytes into a `.part` file while hashing, atomically rename
`.part` into place, mark complete. On per-asset failure the `.part` is removed and the error is
collected (kind ∈ manifest-fetch / signature / sha-mismatch / http / io) — the loop keeps going
so the user gets a complete failure report, not the first error. The result is either ok, or a
failure carrying a **count of still-missing assets** (which the route-selection screen shows).

**Promotion is backup-then-swap.** Delete stale backup → if a live pack dir exists, rename it to
`.backup` → rename staging into place → on failure, rename backup back → on success, best-effort
delete backup. Crash recovery reasons over the (final, staging, backup) triple, and the stated
invariant is that **recovery never deletes staging** — staging holds verified partial assets and
is the resume substrate. Where final and backup both exist, the promoted final is fully
re-verified before the only known-good rollback copy is discarded.

**Resume is hash-based, not offset-based.** Nothing trusts a byte offset across process death;
it re-hashes what is on disk and skips whole assets that already verify. That is why the asset
granularity matters — assets should be small enough that re-fetching one is cheap.

**"Startable" is a separate predicate** from "downloaded": the final directory must exist, the
signed control file must exist, and every `pack_progress` row for that pack must be complete.

**Budget / eviction.** A configurable ceiling (default 2 GiB) with two modes: `manual` (report
the overage and let the user decide) and `auto` (evict least-recently-used packs until the new
pack fits). Outcomes are an explicit union: ok / over-budget-manual / over-budget-evicted /
over-budget-blocked. The active tour's pack is never evictable — so "blocked" is a real state
when the only remaining pack is the one playing. Eviction removes the directory, the LRU row and
the `pack_progress` rows together. All budget mutations run under a mutex shared per storage
handle (via a WeakMap) so two callers cannot race the same accounting.

**Device open is a singleton promise** — remount/fast-refresh must not open a second SQLite
handle on the same file, which can hang forever after a force-quit. There is an explicit
last-resort recovery that deletes the DB file and reopens.

### 4. Backend surface

Fastify, self-hosted, built by a factory that returns the app without listening — the same code
path serves tests and production. Every JSON response is a signed envelope.

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/v1/catalog` | List available bundles: bundleId, version, sizeBytes, requiredAppVersion, plus a fetch timestamp. Signed with the catalog key. | None (public) |
| GET | `/v1/catalog/:bundleId/:version/manifest.lock.json` | The signed lock payload for one pack version. 404 `manifest_not_found`. | None |
| GET | `/v1/catalog/:bundleId/:version/manifest.lock.sig` | Detached signature (+kid) over the same canonical bytes as above. 404 `manifest_not_found`. | None |
| GET | `/v1/catalog/:bundleId/:version/asset/*` | Serve one pack asset as octet-stream. Supports HTTP Range: 200 full, 206 partial, 416 unsatisfiable with a Content-Range of `bytes */size`; always advertises `Accept-Ranges` and a custom header naming the detached-signature URL. 400 `asset_path_required`, 404 `asset_not_found`. | None |
| GET | `/v1/gtfs/:cityId/latest` | Pointer to the newest GTFS feed for a city: feedVersion, downloadUrl, sha256, publishedAt. Signed. 404 `gtfs_not_found`. | None |
| GET | `/v1/entitlements` | Resolve entitlements for a device. Signed with the entitlement key. 400 `device_id_required`. | Device id via `?deviceId=` **or** `X-Device-Id` header |
| POST | `/v1/entitlements/receipt` | Submit one platform IAP receipt. 400 `invalid_receipt`, 429 `rate_limit_exceeded` (+Retry-After), 503 `receipt_verification_unavailable`. | Device id in body |
| POST | `/v1/entitlements/restore` | Submit a batch of receipts to restore purchases on a new device. 400 `invalid_restore`, 400 `too_many_receipts` (cap 100), 429, 503. | Device id in body |
| GET | `/v1/moderation` | List of disabled segment ids + fetch time. Signed with the catalog key. | None |

**Entitlement model.** An entitlement is `{ tier, bundleId?, grantedAt, expiresAt? }` with tier ∈
{free, time_pass, token_unlock, b2b}; absent `expiresAt` means permanent. The response also
carries an `expiryUtc` — the *cache-honouring deadline*, i.e. how long the client may keep
trusting this answer offline. Identity is a locally generated UUID stored in the single-row
`device_id` table: no email, no phone, no social login, ever. Receipts are recorded idempotently
on `(deviceId, platformReceiptId)`, which is the replay defence.

**How the client trusts it.** Not by trusting TLS. The signed envelope is verified against the
pinned public key *before* the payload is read, cached or persisted, and a signature failure
raises a distinct error type from an HTTP error — the design's own justification is that a
café-Wi-Fi MITM must not look like an ordinary offline blip. The verified payload is cached with
its declared expiry; on network failure the client falls back to the cache, and will even serve a
*stale* cache rather than dropping entitlements, because a paying user on a train with no signal
must not lose access. Only with no cache at all does it throw.

**Receipt verification is fail-closed by design.** The mode is either `stub` (dev, accepts any
well-formed receipt) or `reject` (503 for everything). Anything other than an explicit opt-in
resolves to reject, and stub mode prints a large boxed stderr warning at startup. Real Apple
StoreKit / Google Play verification is documented as the next step but not implemented.

**Other backend hardening worth noting:** asset paths are joined through a checked helper that
refuses NUL bytes and any result escaping the asset root; ranged reads use a positional file read
that allocates only the requested window (an earlier version read whole files into memory and
OOM'd under concurrent small-range tile requests); the entitlement expiry is computed per request
rather than once at boot (an earlier version went stale after 24 h and caused refetch storms);
the rate limiter is disposed on server close so tests don't leak timers.

### 5. Authoring

A six-stage pipeline with named accountable roles: (1) machine skeleton — coordinates from GTFS
or OSM, never hand-typed and never AI-generated; (2) AI draft prose, claims marked unchecked;
(3) independent fact-check by someone who has *not* seen the drafting context, each claim gets a
verdict and a source URL; (4) human review sign-off; (5) budget & tone pass — word count against
the real gap between stops at roughly 2.6 words/second, memorial material marked; (6) validate
and sign.

The motivation is documented bluntly: three factual errors shipped in the first draft, one of
which survived two human review passes. The conclusion drawn — **prose review by eye does not
catch this class of error, so fact-checking must be structural and machine-enforced** — is the
single most valuable idea in this package.

**Frontmatter contract per narrative file.** Required: `poiId` (must match `pois.json`) and
`language`. Review gate: `claims[]` each `{ id, text, verdict, sourceUrl?, checkedAt? }` with
verdict ∈ {confirmed, refuted, unverifiable, unchecked}; `review` = `{ reviewedBy, reviewedAt,
decision }` with decision ∈ {approved, rejected, pending}; `tone` ∈ {standard, memorial}.
Optional: `durationHintSec`, `tier` (inherits from the parent POI when absent), `sponsor`,
`disclosure`, `licenses[]` each `{ id, attribution }`. The schema encodes a conditional: declaring
the b2b tier makes sponsor **and** disclosure required — undisclosed paid content is structurally
unshippable.

`tone: memorial` is not decoration: at runtime it slows speech (~0.9× rate) and suppresses
adjacent trivia. The rationale given is that narrating mass graves in the same brisk voice as
shopping tips is the largest single reputational risk in the content.

**Validation is three nested levels**, each a superset of the last:
- **default** — schema validity, cross-file invariants, no `refuted` claims, every `confirmed`
  claim has a source URL, bundle identity agrees across files.
- **`--strict`** — plus: approved review on every narrative, and no `unchecked` or
  `unverifiable` claims remaining.
- **`--release`** — implies strict, plus: every stop carries `gtfsStopId` and
  `scheduledOffsetSec`.

**Error codes** are a closed, documented set with a fix instruction per code: schema-violation,
parse-error, missing-file, transcript-missing, default-language-missing-from-languages,
default-language-narrative-missing, b2b-disclosure-missing, cc-license-incomplete, duplicate-id,
standby-file-missing, refuted-claim, confirmed-claim-missing-source, unchecked-claim (strict),
unverifiable-claim (strict), review-not-approved (strict), memorial-segment-empty,
bundle-id-mismatch, release-gtfs-field-missing (release).

**CLI.** `bundle-validate [--json] [--strict] [--release] <dir>`. Exit 0 valid, 1 validation
errors, 2 bad arguments. Human output groups errors by file and prints
`file pointer :: message` + a hint line; `--json` emits the raw error array for CI. Errors carry
an RFC-6901 JSON Pointer, so an editor can jump to the offending field. The validator runs
against an injected filesystem abstraction, so it is testable without touching disk, and it
collects *all* errors in one pass (Ajv in allErrors mode) instead of drip-feeding.

**Author → signed bundle.** A build script reads the authored data modules, emits
`manifest.json`, `route.json`, `pois.json`, the narrative markdown files (frontmatter generated
mechanically) and tiles; hashes every file; assembles the lock payload; canonicalises it; signs
it with the local private key; and writes the lock, the detached signature, a per-version
manifest copy for the backend, and the catalog entry. One detail worth copying: the script
**refuses to emit review/claims frontmatter it cannot honestly attest**, so the generated dev
pack passes default validation and correctly *fails* `--strict`. Honest failure over a green
checkmark.

---

## Design decisions worth copying

1. **`bundleId@version` as the atomic unit, versioned directory on disk.** Makes updates,
   rollback and "two versions coexisting" free. KUDY should do exactly this.
2. **Split authored files from a machine-generated lock.** Humans never hand-maintain hashes.
   The lock is the only thing that needs signing/verifying, and it is derived, so it cannot
   drift.
3. **Hash-based resume, not offset-based.** Re-hash what's on disk, skip what verifies. Immune
   to torn writes, crashes and clock nonsense. Requires assets to be reasonably small.
4. **Stage → verify everything → atomic rename.** A pack is either absent or complete; there is
   no half-installed state a user can start a tour from. Plus backup-then-swap for reinstall.
5. **`pack_progress` as an explicit per-asset ledger, with a "missing count" surfaced in the
   UI.** Partial downloads become an honest, actionable state instead of a spinner.
6. **Language as a map key inside one pack, with the "audio implies transcript" invariant.**
   Cheap multilingual support, and accessibility is enforced structurally rather than
   remembered.
7. **Separate default / strict / release validation levels.** Lets real content ship while
   honestly recording what is still missing (here: GTFS ids). Far better than either blocking
   everything or silently accepting nulls.
8. **Omit unknown fields; never invent nulls.** "Absent because unknown" and "known to be
   absent" are different, and the schema refuses to conflate them.
9. **Machine-enforced fact-checking with per-claim verdicts + source URLs.** For a
   history-heavy walking tour in Gdańsk, generated by an LLM, this is *the* mechanism that
   keeps a founder out of trouble. `refuted` = hard fail even at default level.
10. **`tone: memorial` as content metadata with runtime consequences.** Gdańsk has Westerplatte,
    the Post Office, the shipyard. The same reputational risk applies directly.
11. **Distinct error type for signature failure vs network failure.** A tamper signal must never
    be swallowed by generic retry logic.
12. **Signed entitlements cached with a declared expiry, and a stale cache preferred over
    revocation.** A paid user offline keeps access. This is the correct failure direction for
    consumer content.
13. **Anonymous device UUID, no accounts.** Lowest possible friction and the smallest possible
    privacy surface. Restore is done through platform receipts.
14. **Receipt verification fails closed with a loud dev-stub warning.** The pattern (explicit
    opt-in env var, screaming banner, 503 otherwise) is exactly right for solo work where the
    dev config *will* eventually be deployed by accident.
15. **Idempotent receipt recording on (deviceId, receiptId).** Replay protection for free.
16. **Range-supported asset serving with positional reads.** Resume works, and memory does not
    explode under concurrent range requests.
17. **A single HTTP chokepoint** with two guards: no outbound calls during an active tour
    (except loopback), and no large downloads on a metered connection without explicit opt-in.
    Both are user-visible promises enforced in one place rather than by discipline.
18. **The validator CLI returns JSON Pointers and machine-readable error arrays.**
    Trivially wired into CI and into an LLM-assisted authoring loop.
19. **`.tramio/` control directory for the signed envelope**, excluded from its own asset list —
    a clean way to keep provenance metadata inside the pack without recursion.

## Design decisions to reject (and why)

1. **Ed25519 pack signing — reject for a one-city solo MVP.** The verdict asked for:
   *drop it, keep the hashes.* Reasoning:
   - The threat model that signing addresses is "an attacker who controls the transport serves
     you a different pack". HTTPS with certificate validation already covers that. The residual
     threat is a *compromised CDN/origin* — but for a solo founder, the same laptop holds the
     signing key, the deploy key and the CDN credentials, so an attacker who gets one gets all.
     The signature protects nothing that isn't already lost.
   - Signing does **not** prevent content theft. Content is decrypted/played on a device the
     user controls. Only per-user encryption plus DRM even attempts that, and it is not worth
     it for city walking tours.
   - The real costs are ongoing: key custody, key rotation, a kid policy, a build step that
     fails without a local private key, a React-Native crypto shim (no WebCrypto SHA-512), and
     an entire error taxonomy plus recovery UX.
   - **What to keep instead:** the lock file with per-asset SHA-256 and byte sizes, fetched over
     HTTPS from your own origin, and verified at download and at load. That gives corruption
     detection, resume, and torn-write safety — 90% of the practical value at ~5% of the cost.
   - **Signed short-TTL CDN URLs** solve a *different* problem (stopping non-purchasers from
     downloading paid packs) and are the right tool for it: the backend checks the entitlement,
     mints a URL valid for a few minutes, and the CDN enforces it. That is one small backend
     endpoint plus a CDN feature you already pay for, with no key you must manage on device.
     **Recommendation: signed short-TTL URLs for access control; plain SHA-256 lock for
     integrity; no Ed25519.** Revisit signing only if you ever ship third-party-authored packs.
2. **Two key classes with kid namespaces and a rotation registry.** Rotation infrastructure for
   a system with two keys and one deployer is pure ceremony.
3. **Hardware-backed key provisioning + HKDF-derived wrapping keys + AES-256-GCM framed
   encryption of pack assets (the `crypto-service` package).** This is a serious DRM effort —
   Keychain/Keystore/StrongBox, 64 KiB chunk framing with per-chunk nonces and sequence numbers
   in the AAD, opaque key handles, streaming decrypt. For a solo founder selling ~€5 city tours
   it is months of work protecting content that is worth less than the effort. The pack format
   already makes it optional (`protected` / `encryption` per asset) — leave those fields unused.
4. **License tokens as JWS with their own cache table and refresh lifecycle,** on top of the
   entitlement cache. Two overlapping trust artefacts for one purchase. Keep only the signed —
   or plain HTTPS — entitlement cache.
5. **The three-way (final, staging, backup) crash-recovery state machine.** Correct, and
   genuinely hard to get right. Simplify: staging + atomic rename, and on any ambiguity delete
   staging and re-download. For a ~50 MB city pack on Wi-Fi that is seconds, not a crisis. Keep
   `pack_progress` for resume within a session; don't build backup/rollback.
6. **LRU eviction with a 2 GiB budget, manual/auto modes, and a four-outcome result union.**
   One city, a handful of routes. Show total size and give the user a delete button. Revisit
   when a second city exists.
7. **A separate self-hosted Fastify backend for the catalog.** For static, rarely-changing
   content this can be object storage plus a CDN: a static catalog JSON and static pack files.
   You still need a *small* server for receipt verification and for minting signed download
   URLs — but that is one serverless function, not a service.
8. **GTFS ingest, feed-age policy (30-day warning / 90-day dead-reckoning cutoff), CSV parsing,
   feed replacement.** Entirely transit-specific. A walking tour has no timetable. Drop the
   whole `gtfs/` subtree and the `/v1/gtfs/:cityId/latest` endpoint.
9. **`transitLine`, `deadReckoning`, `standbyTracks`, `deviationCorridorMeters`,
   `scheduledOffsetSec`, `directionFilter`.** All artefacts of "content delivered from a moving
   vehicle on a fixed line". A walker has no kerb side and no schedule. `directionFilter` is the
   one to think twice about — a walking route with a there-and-back leg has the same problem —
   but implement it only if a Gdańsk route actually doubles back.
10. **Four entitlement tiers (free / time_pass / token_unlock / b2b) plus per-narrative
    `deeperLayers` with independent tiers.** A pricing matrix before there is a single sale.
    Ship two states: free sample and purchased route. The `b2b` sponsor/disclosure machinery is
    a solution to a problem you do not have; it can be added later without breaking the format.
11. **`moderation_snapshot` / `GET /v1/moderation` (remotely disabling individual segments).**
    This exists because Tramio expects third-party or crowd content. You write everything;
    if a segment is wrong, publish a new pack version.
12. **A `_schema_version` table and a migration runner on day one.** With one table set and one
    developer, "recreate the DB if the version differs" is sufficient — the data is a cache,
    not a source of truth. (Borderline: the cost is low. But note the schema currently ships as
    one idempotent blob at version 1, so the runner has never actually migrated anything.)
13. **The full six-role authoring pipeline with named accountable humans.** You are all six
    roles. Keep the *artefacts* (claims with verdicts + source URLs, a review flag, strict mode)
    and collapse the roles — but do keep the discipline that the fact-checking pass runs in a
    fresh context that has not seen the drafting conversation. That specific separation is what
    catches LLM confabulation, and it costs you nothing but a new chat window.

## Verdict: what a 1-city solo MVP keeps vs drops

**Keep (build these):**
- Versioned pack directory `packs/{routeId}/{version}/`, authored JSON + markdown + audio.
- A generated lock file listing every asset with `path`, `sizeBytes`, `sha256`. Verify at
  download and at load. **No signature.**
- Staging directory + atomic rename; a `pack_progress`-equivalent table for per-asset resume.
- One SQLite file with three tables: per-asset download progress, purchased-routes cache with
  an expiry, and the anonymous device id.
- A static catalog JSON on the CDN + one serverless endpoint that verifies an IAP receipt and
  mints a short-TTL signed download URL. Fail closed.
- Language as a map key; audio always accompanied by its transcript text.
- A `validate` script with two levels (default and strict) enforcing: schema validity, every
  referenced file exists, default-language coverage, claim verdicts with source URLs, no
  refuted claims, and a spoken-duration budget per POI.
- `tone: memorial` on Westerplatte / Post Office / shipyard material.

**Drop (do not build):**
Ed25519 signing and key management, the crypto-service/DRM stack, license tokens, LRU eviction
and storage budgets, backup/rollback recovery, the moderation endpoint and table, the GTFS
subsystem and endpoint, all transit-specific manifest fields, the four-tier entitlement matrix
and deeper layers, the b2b sponsor/disclosure machinery, the migration runner, and the
self-hosted Fastify service.

## Gotchas / platform realities discovered

- **React Native has no WebCrypto SHA-512**, so any Ed25519 library must be hand-wired with a
  hash implementation. Another reason to avoid signing on device.
- **Opening SQLite twice on the same file can hang forever after a force-quit.** The fix is a
  module-level singleton promise for the open, cleared on failure so a retry is possible, plus
  an explicit "delete the DB and start over" recovery path. Fast Refresh during development is
  what triggers this.
- **Streaming is mandatory for asset download.** Buffering a whole audio file before hashing
  defeats both memory limits and resumability; the fetch abstraction is explicitly documented
  as forbidden from buffering.
- **Naive ranged reads on the server load the whole file** — fine in dev, an OOM under
  concurrent tile requests. Use positional reads sized to the requested window.
- **Caching a computed expiry timestamp at process start goes stale** and causes every client to
  refetch forever. Compute per request.
- **In-progress files need a distinct suffix** (`.part`) and must be removed on error, or a
  truncated file will be mistaken for a complete one.
- **Atomic rename only works within one volume.** The staging directory must be a sibling of the
  destination, not in a temp directory elsewhere.
- **Pack ids reaching the filesystem are untrusted input.** Validate them as single safe path
  segments at the boundary; the server independently refuses joined paths that escape the asset
  root or contain NUL bytes.
- **JSON key order is not stable across serializers**, which is why anything hashed or signed is
  canonicalised (recursive key sort) first. This bites even without signing if you hash JSON.
- **Emulator gateway addresses** (the Android/Genymotion host IPs) must be exempted from a
  "block network during tour" rule, but exempting the whole private range is wrong — café and
  corporate Wi-Fi live there.
- **Uniqueness checks over optional fields need per-index sentinels**, or 36 stops with no GTFS
  id all report as duplicates of each other.
- **Missing optional fields must be omitted, not nulled** — a schema with `additionalProperties:
  false` and typed fields rejects nulls, and rightly so.
- **Content expires.** The manifest has a `validUntil` field and a previous demo pack is
  described as having expired. Seasonal claims ("open daily until 6pm") rot; plan for it.
- **Spoken duration is a real constraint**: roughly 2.6 words per second against the actual
  walking time between two points. Over-long narration is the most common content bug and is
  checkable mechanically.

## Open questions

1. **Access control for paid routes.** If KUDY adopts signed short-TTL CDN URLs, what mints
   them — a serverless function, or does the store put the pack behind an authenticated origin?
   What is the TTL, and how does a resumed download that outlives the TTL re-mint?
2. **Where does the catalog live?** A static JSON file on the CDN is the cheapest option, but
   then "which routes exist" cannot be gated. Is that acceptable (list everything, gate the
   download)?
3. **Audio: pre-rendered or TTS?** Tramio supports both — pre-rendered audio with a mandatory
   transcript, or device TTS reading the markdown. Pre-rendered is dramatically better for a
   story tour, but it makes packs an order of magnitude bigger and makes "fix a typo" a
   re-record. Decide before the format is frozen; the `audio` map + transcript invariant works
   for both.
4. **Pack size budget for Gdańsk.** Tramio's demo pack is tens of kilobytes because it is
   text-only. With narration audio a route is plausibly 50–300 MB, which changes the download
   UX, the asset granularity (resume unit), and whether map tiles ship in the pack at all.
5. **Offline map tiles: in-pack or omitted?** Tramio reserves a tiles path but ships a
   placeholder. Bundling real tiles is a large size and licensing question.
6. **Language strategy.** Polish + English for Gdańsk is the obvious pair, but with pre-rendered
   audio each language roughly doubles pack size. One pack with both, or per-language packs?
   Tramio's answer (one pack, language as a key) assumes text.
7. **Free-sample boundary.** Which POIs are free? Tramio expresses this per POI via `tier`.
   Simplest KUDY equivalent: a small integer "free up to POI N" or a boolean per POI.
8. **Does a walking route need `directionFilter`?** Depends on whether any Gdańsk route
   revisits a location.
9. **Refunds / entitlement revocation.** With a stale-cache-preferred policy, a refunded
   purchase keeps working until the cache expires. What expiry window is acceptable?
10. **Content update policy.** Does the app force an update when a new pack version exists, or
    keep playing the installed one? Tramio surfaces "update available" without auto-downloading
    on metered connections and never touches the network mid-tour — both worth keeping.