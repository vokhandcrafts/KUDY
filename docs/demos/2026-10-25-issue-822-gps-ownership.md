# Уласнасць GPS-падпіскі прагулкі (G20.42)

*2026-10-24T22:48:00Z by Showboat 0.6.1*
<!-- showboat-id: 8e145e1b-1b41-420a-a45f-ef573fdfda9c -->

Матрыца #822: Pause/Resume/End/Back вызваляюць або трымаюць раўна адну GPS-падпіску і яе gap-watch. Сюіты сэрвіса, аркестратара і кантролера праходзяць на ўбудаваным фіктыўным порце з ручным гадзіннікам; guard-тэсты падаюць пры адкатзе бар'ераў.

```bash
node --test --experimental-strip-types services/location/service.test.ts controllers/run/runOrchestrator.test.ts controllers/useRunController.test.ts > /dev/null 2>&1 && printf 'G20.42 suites (service, orchestrator, controller): PASS\n'
```

```output
G20.42 suites (service, orchestrator, controller): PASS
```

Прыборная матрыца — suite gps (npm run e2e:android -- --suite gps): 5/5 на эмулятары google_apis, artifacts 2026-10-24T22-29-50-848Z. Знойдзены дэфект F1 — ungated auto-start праз deep link пасля End — зафіксаваны ў #862; прыборны сцэнар фіксуе запісаныя паводзіны і перагортваецца разам з будучым фіксам.
