# APR-04 — дасяжнасць Android-экранаў

*2026-10-18T19:37:38Z by Showboat 0.6.1*
<!-- showboat-id: c28b2559-e01b-4eec-a0c3-afe4929c9875 -->

Доказ на ўзроўні RN-render: мэты націску не меншыя за 48 dp, а фільтры, спасылкі, выбар аўдыё і Run атрымалі падпісы, ролі і стан. Гэта не заменіць TalkBack ці Accessibility Scanner на Android-прыладзе.

```bash
output=$(npm exec -- jest --runInBand --silent components/pressable-surface.test.tsx components/back-button.test.tsx components/run-native-map.test.tsx app/discovery.test.tsx app/preview.test.tsx app/run.test.tsx 2>&1); code=$?; if [ "$code" -ne 0 ]; then printf "%s\n" "$output" | tail -60; exit "$code"; fi; printf "%s\n" "$output" | grep "^PASS " | sort; printf "%s\n" "$output" | grep -E "^(Test Suites:|Tests:)"
```

```output
PASS app/discovery.test.tsx
PASS app/preview.test.tsx
PASS app/run.test.tsx
PASS components/back-button.test.tsx
PASS components/pressable-surface.test.tsx
PASS components/run-native-map.test.tsx
Test Suites: 6 passed, 6 total
Tests:       102 passed, 102 total
```
