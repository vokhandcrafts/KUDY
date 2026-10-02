# G20.05 — рэчэк згоды перад кожным батчам аналітыкі (issue #476)

Сцэнар аудыта A26-05 над рэальнымі модулямі `services/analytics.ts` і
`services/eventLog.ts`: 257 падзей у чарзе, адкліканне згоды трапляе ў
сэнсар падчас палёту першага батча (256). Рэчэк перад кожным батчам
спыняе другі: сэнсар выкліканы адзін раз, хвост — pending бяз пазнакі.
Аднаўленне згоды даганяе чаргу тым жа event_id бяз дублёў.

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
node --experimental-strip-types tests/analytics/g2005-demo-driver.ts 2>/dev/null
```

```output
G20.05 {"queued":257,"firstBatchSize":256,"senderCalls":1,"marked":256,"pendingTail":["55555555-5555-4555-8555-000000000256"]}
G20.05-resume {"marked":1,"sentIds":["55555555-5555-4555-8555-000000000256"],"pendingAfterResume":0}
```

Revert-праверкі (правіла 1): вяртанне `flushAnalytics` да
`flushEvents(driver, send)` бяз гейта робіць тэст «G20.05
revoke_between_batches…» чырвоным — сэнсар выклікаецца двойчы (256+1),
рэгрэсія аудыта ўзнаўляецца; зняцце радка гейта ў цыкле `flushEvents` —
чырвоны тэст «the beforeBatch gate stops the flush between chunks…».
