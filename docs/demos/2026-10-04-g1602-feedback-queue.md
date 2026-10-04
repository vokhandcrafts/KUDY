# #73 — durable feedback queue: crash window and honest recovery

*Showboat demo for issue #73 (G16.02, `services/feedbackRepository` +
`services/feedbackSync`), created 2026-10-04.*

`21` §5.4 promises the rater that an explicit Send persists the draft and the
operation in one transaction before the network, that a crash mid-fetch is
recovered by replaying the same mutation id (the server's idempotency answers
it), and that a transient failure returns the operation to `pending` under a
bounded backoff instead of losing or duplicating the rating. The demo drives
the production repository and sync over a real file-backed SQLite store with a
scripted transport — a crash is simulated by closing the process between the
send-commit and the response, exactly the state a killed app leaves behind.
Ids and the clock are fixed, so the trace is deterministic.

Send, then the crash (the operation is committed locally, nothing on the wire):

```sh
rm -rf /tmp/kudy-g1602-demo && node --experimental-strip-types tests/feedback/queue-demo.ts 2>/dev/null
```

```output
after Send   : local={"state":"pending","revision":0,"score":null,"draft":null} outbox=[{"transport_state":"pending","attempts":0,"next_attempt_at":null}]
first flush  : dispatched=1 acknowledged=0 requeued=1
after 503    : local={"state":"pending","revision":0,"score":null,"draft":null} outbox=[{"transport_state":"pending","attempts":1,"next_attempt_at":1770000062248.245}]
second flush : dispatched=1 acknowledged=1 requeued=0
after ACK    : local={"state":"sent","revision":1,"score":2,"draft":null} outbox=[]
```

Reading the trace: after Send the draft is consumed into one queued operation
(`pending`, revision 0). The restart re-arms the committed queue; the server's
503 answers `requeued=1` with `attempts=1` and the next attempt scheduled by
the §5.4 ladder — «backoff 2, 4, 8… секунд, мяжа 5 хвілін, з jitter»: 2 s
jittered by this mutation id, so ~2.25 s after the failed attempt
(`next_attempt_at` = 1770000000000 + 62248.245, the restart moment
1770000060000 included). The second flush replays the same mutation id, the
acknowledgement lands and the target ends `sent` at revision 1 with score 2 —
one record, no duplicates, no lost vote. The scenario is the send-crash window
of `queue-durability.test.ts`; the full acceptance suite is
`tests/feedback/queue*.test.ts`.
