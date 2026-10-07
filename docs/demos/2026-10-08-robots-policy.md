# Правіла robots.txt для публічнага вэба

*2026-10-07T22:39:17Z by Showboat 0.6.1*
<!-- showboat-id: 4248aa4f-e157-42fd-a760-d3b1ef7cd2ee -->

Маршрут robots.txt адкрывае старонкі для індэксацыі і выключае толькі дрэва кантэнтных файлаў /content/. Праверка ніжэй выконвае функцыю таго самага маршруту, які выкарыстоўвае статычны экспарт Next.js.

```bash
node --experimental-strip-types --input-type=module -e "import robots from './web/app/robots.ts'; console.log(JSON.stringify(robots()))"
```

```output
{"rules":{"userAgent":"*","allow":"/","disallow":"/content/"}}
```
