# #727 — Start gate і поўны package lock прылады

*2026-10-11T23:59:00Z by Showboat 0.6.1*

Кампазіцыйны тэст пінавіць рэальны вердыкт Start-гейта (`enabled=true` пасля загрузкі); эксперымент адкату без праводкі `evaluateLayer` дае дакладна прыладны сімптом `preview#verify-unavailable` — запісаны ў [results/727.md](../agent-tasks/results/727.md). Тэст упакоўшчыка пінавіць lock кожнага апублікаванага пласта. Прыладныя кадры AVD `kudy-test`: Start пасля загрузкі, жывы Run і аднаўленне праз `kudy:///run/e2e-free-guide`.

```bash
node --test --experimental-strip-types --experimental-test-module-mocks controllers/sessionPorts.evaluateLayer.test.ts controllers/deviceServices.integration.test.ts > /tmp/kudy727-gate.log 2>&1 && echo 'Start gate derives a real evaluate verdict: PASS'
```

```output
Start gate derives a real evaluate verdict: PASS
```

```bash
node --test --experimental-strip-types --experimental-test-module-mocks tools/build-bundle/build-bundle.test.mjs > /tmp/kudy727-pack.log 2>&1 && echo 'Published layer locks pin the run documents: PASS'
```

```output
Published layer locks pin the run documents: PASS
```

![Start пасля завершанай загрузкі](../testing/evidence/2026-10-11-g727/preview-start-enabled.png)

![Жывы Run пасля Start](../testing/evidence/2026-10-11-g727/run-active.png)

![Run праз kudy:///run/e2e-free-guide (§9.1 аднаўленне)](../testing/evidence/2026-10-11-g727/run-deeplink.png)
