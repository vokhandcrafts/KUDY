# DQ-02 — гісторыі карткі гіда і dev-only экран узораў

*2026-10-31 by Showboat 0.6.1*
<!-- showboat-id: f32131df-9d95-4cdc-9f3c-8847dc509955 -->

Задача [#911](https://github.com/vokhandcrafts/KUDY/issues/911). Станы
карткі гіда запісаныя адзін раз у CSF-гісторыях
`components/guide-card.stories.tsx`; dev-only маршрут
`app/dev-specimen.tsx` малюе іх па глыбіннай спасылцы
`kudy:///dev-specimen?component=guide-card` без інтэрфейсу Storybook.
Абедзве каманды ніжэй ідуць з кораня рэпазітарыя.

Першы блок — брама рэлізу: па-за `__DEV__` паверхня нічога не малюе.
Выдаленне гейту перад першым выклікам хукоў (ідыём `han-probe.tsx:143`)
рабіць гэты блок чырвоным — праверана адкатам 2026-10-31 у сесіі змены.

```bash
npx jest --config jest.config.js --runInBand app/dev-specimen.test.tsx -t "outside __DEV__" >/dev/null 2>&1 && printf 'DQ-02 release gate: PASS\n'
```

```output
DQ-02 release gate: PASS
```

Другі блок — кожная іменаваная гісторыя `guide-card.stories.tsx` малюецца
праз экран узораў з подпісам па імені гісторыі.

```bash
npx jest --config jest.config.js --runInBand app/dev-specimen.test.tsx -t "renders every story" >/dev/null 2>&1 && printf 'DQ-02 every story renders through the specimen: PASS\n'
```

```output
DQ-02 every story renders through the specimen: PASS
```
