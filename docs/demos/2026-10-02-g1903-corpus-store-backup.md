# G19.03 — the corpus store: idempotent registration, busy diagnostics and a restore that refuses tampered backups

*2026-10-02 by Showboat 0.6.1*

The corpus store (`tools/corpus/store.mjs`, issue #460) is the SQLite owner of
packages, machine results, author decisions and Cases (specification 25 §9).
The harness `tools/corpus/demo-g1903.mjs` drives the real modules over a
scratch directory with synthetic data only — every id is a hash of a literal
string, no network call exists on any path.

Registration, foreign keys and the second write session, live:

```sh
node tools/corpus/demo-g1903.mjs
```

```output
registration: first=false second=true
orphan rule: orphan-fragment
busy rule: db-busy
backup files: 5
restore: results=1 media=2 cases=1
corrupt rule: backup-checksum-mismatch
corrupt target created: false
```

Read back: the second registration of the same package changes nothing; a
fragment naming another revision is rejected before any row is written
(`orphan-fragment`); while the first connection holds the write lock, a second
write session answers the named `db-busy` diagnostic instead of hanging. The
backup captures the consistent database image plus the package files; the
restore reproduces the machine result, both image associations and the Case
in a fresh directory; a tampered backup file answers
`backup-checksum-mismatch` and materializes nothing.
