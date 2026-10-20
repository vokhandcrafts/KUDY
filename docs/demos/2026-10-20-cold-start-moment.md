# Moment пасля халоднага старту

*2026-10-20 by Showboat 0.6.1*

Праверка выкарыстоўвае вытворчую кампазіцыю, сапраўдную SQLite-сесію і
правераны сінтэтычны пакет. Пасля перастварэння каранёвай кампазіцыі Place
адкрываецца без наведвання Run: Moment трапляе ў рухавік жывой сесіі, а
падчас аднаўлення асобны аўдыязапуск забаронены. Трэці тэст не дазваляе
Nearby паказаць падказку ў кантэксце Idle да аднаўлення Run.

```bash
node --test --experimental-strip-types --experimental-test-module-mocks --test-name-pattern='G23.06:|persisted live walk awaiting recovery' controllers/deviceServices.integration.test.ts controllers/useNearbyController.test.ts >/dev/null && echo 'cold-start Moment and hint routing: PASS'
```

```output
cold-start Moment and hint routing: PASS
```
