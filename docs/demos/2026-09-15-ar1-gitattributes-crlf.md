# AR-1: .gitattributes keeps fixture hashes valid on a CRLF checkout

*2026-09-15T19:26:52Z by Showboat 0.6.1*
<!-- showboat-id: 259c9f0a-a139-4d7c-8ec7-d64d155261d5 -->

Fix for AR-1 (#78): lock.json records sha256 over LF bytes, but core.autocrlf=true checked the fixtures out with CRLF, so integrity verification failed on a fresh Windows checkout. The committed .gitattributes pins eol=lf for the hashed fixture assets; the re-checked-out fixtures verify and the package activates.

```bash
cd spikes/G00.02-offline-map && rm -rf runtime && node scripts/prepare-data.mjs
```

```output
{
  "status": "ready",
  "compressedBytes": null,
  "contentBytes": 5541,
  "activePackageBytes": 6667,
  "activationPeakBytes": 6667,
  "prepareMs": 59,
  "note": "regular-file bytes; uncompressed local fixture; no download performed"
}
```

```bash
cd spikes/G00.02-offline-map && node --test test/offline-map.test.mjs 2>&1 | tail -n 8
```

```output
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 606.7903
```
