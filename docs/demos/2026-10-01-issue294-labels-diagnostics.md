# G09.04 — лейкі і дыягностыка метрык

*Showboat demo for issue #294 (G09.04 — лейкі без змяшвання + дыягностыка межаў), created 2026-10-01.*

Сцэнар на рэальным прадакшн-кодзе (`services/metricsReport.ts` над чаргой
`services/eventLog.ts`/`services/db`). Сямі падзеяў хапае на ўсе пяць крытэраў
#294: прагулка без поўнай ланцугі не дае ніводнай няўдачы — страчаны крок
застаецца нулём, не вердыктам; згода/адкліканне і хвост чаргі паказаныя як
межы даных; discovery-opened лічыцца ў сваёй лейцы, а невядомы
тып `rating` трапляе ў unknown, не ў discovery; доля аслабленых крыніц
названая лікам. Гард змяшэння адхіляе лейку з дзвюх катэгорый без ланцугі чытання, але
прагулкавую ланцугу з загрузкай (канон `12`) прымае.
(`export LD_LIBRARY_PATH` — хоставае патрабаванне
node, не частка змены.)

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
node --experimental-strip-types --input-type=module -e '
import { pathToFileURL } from "node:url";
const { openDatabase, markEventsSent } = await import(pathToFileURL("services/db/db.ts"));
const { nodeSqliteDriver } = await import(pathToFileURL("services/db/test-fixture.ts"));
const { emitEvent } = await import(pathToFileURL("services/eventLog.ts"));
const { setAnalyticsConsent } = await import(pathToFileURL("services/analytics.ts"));
const { assertNoCategoryMix, buildMetricsReport, MetricsError } = await import(pathToFileURL("services/metricsReport.ts"));

const driver = nodeSqliteDriver();
openDatabase(driver);
const emit = (id, type, at, payload) =>
  emitEvent(driver, { eventId: id, type, at, schemaVersion: 1, payload: payload ?? "{}" });

emit("evt-01", "route_preview", 1);
emit("evt-02", "download_completed", 2, JSON.stringify({ download_id: "dl-1", bytes: 10 }));
emit("evt-03", "session_started", 3);
emit("evt-04", "story_play_started", 4, JSON.stringify({ stop_id: "s1", story_id: "st1", play_id: 1, trigger: "gps" }));
emit("evt-05", "session_ended", 5, JSON.stringify({ reason: "user_stop", heard_stories_count: 1 }));
emit("evt-06", "discovery_offer_opened", 6, JSON.stringify({ discovery_revision: "r1", offer_id: "o1", kind: "guide", content_locale: "be", surface: "discovery" }));
emit("evt-07", "rating", 7, JSON.stringify({ score: 5 }));
markEventsSent(driver, ["evt-01", "evt-02", "evt-03"]);
setAnalyticsConsent(driver, "revoked");

const report = buildMetricsReport(driver);
const reading = (funnel) => report.readings.find((entry) => entry.funnel === funnel);
console.log("failures:", JSON.stringify(report.failures));
console.log("listening.story_audio_completed:", reading("listening").steps.find((step) => step.type === "story_audio_completed").count);
console.log("consent:", report.boundaries.analytics_consent, "future_sends_blocked:", report.boundaries.future_sends_blocked);
console.log("pending:", report.boundaries.pending_events, "server_visibility_ends_at:", report.boundaries.server_visibility_ends_at);
console.log("sample:", JSON.stringify(report.sample));
console.log("unknown:", report.unknown_types.join(","));
console.log("discovery observations:", reading("discovery").observations);
try {
  assertNoCategoryMix(["route_preview", "purchase_started"]);
  console.log("two-category merge: accepted");
} catch (error) {
  console.log("two-category merge refused:", error instanceof MetricsError ? error.rule : "other");
}
try {
  assertNoCategoryMix(["route_preview", "download_completed", "session_started"]);
  console.log("walk chain accepted");
} catch {
  console.log("walk chain refused");
}
' 2>/dev/null
```

```output
failures: []
listening.story_audio_completed: 0
consent: revoked future_sends_blocked: true
pending: 4 server_visibility_ends_at: 3
sample: {"events_total":7,"server_visible_events":3,"weakened_share":0.5714285714285714}
unknown: rating
discovery observations: 1
two-category merge refused: label_mix
walk chain accepted
```

Лічбы адпавядаюць сюіту `services/metricsReport.test.ts`: ніводнай няўдачы на
незавершаным слуханні; адкліканая згода і чатыры адпраўленыя (pending)
падзеі — як межы; доля аслабленых крыніц 4/7; `rating` — у unknown_types,
 discovery-лейка цэлая; змяшэньне катэгорый — іменаваная адмова.
