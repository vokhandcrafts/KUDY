# G20.10 — the bounded network wait: deadlines, named rejections and redacted byte transfers

*2026-10-02 by Showboat 0.6.1*

Every network wait in the device path is finite (specification network-privacy
§N4): the single owner of the limits is `services/network-wait.ts`
(`NETWORK_WAIT_LIMITS` + `withWaitLimit`), and the deadline covers the whole
document — headers and body — because the abort signal stays live until the
run completes. The harness `services/demo-g2010.ts` drives the real owner and
two production wirings against a stubbed platform fetch that never resolves;
the output carries rules and redacted replies only — no URL, no credential.

```sh
node --experimental-strip-types services/demo-g2010.ts 2>/dev/null
```

```output
deadline: rule=wait-config kind=timeout aborted=true
catalog loader: wait-catalog
diagnostic: grant-fetch:remint path_index=0 reason=window
diagnostic: grant-fetch:wait-timeout rule=wait-grant-bytes
bytes reply: grant-fetch#transfer-failed
```

Read back: the deadline fires the named `WaitTimeoutError` (kind `timeout`)
and aborts the signal the running request holds, so an adapter that honors
the signal stops transferring the body; the catalog loader rejects with its
own `wait-catalog` rule and the reader policy falls back to the validated
copy; the grant byte source mints normally, stalls on the transfer, and the
deadline surfaces as the named `wait-grant-bytes` diagnostic plus the
redacted `grant-fetch#transfer-failed` reply — the URL and the credential
never reach the journal.
