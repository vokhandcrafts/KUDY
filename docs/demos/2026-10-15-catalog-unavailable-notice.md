# Catalog unavailable notice

*2026-10-15T10:16:38Z by Showboat 0.6.1*
<!-- showboat-id: d0ef3295-b241-43ca-b301-b0a08afc390e -->

Explore і рубрыка гідаў паказваюць лакалізаванае паведамленне аб адсутнасці каталога ў notice-блоку. Навігацыя застаецца даступнай; кнопкі паўтору няма, бо без сэрвісу каталога няма чаго паўтараць. Праверка ніжэй праходзіць праз абодва экраны з пустым наборам партоў.

```sh
node_modules/.bin/jest --config jest.config.js app/navigation.test.tsx --runInBand -t "a build without the catalog ports|the rubric shows the unavailable notice" 2>&1 | grep -E "^(Test Suites:|Tests:)"
```

```output
Test Suites: 1 passed, 1 total
Tests:       19 skipped, 2 passed, 21 total
```

Гэта праверка дрэва React Native і кантракта паведамлення. Новы выгляд на прыладзе не фатаграфаваўся; візуальны агляд патрабуе зборкі з гэтай галіны на эмулятары або тэлефоне.
