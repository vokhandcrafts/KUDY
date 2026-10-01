# Issue #445 — play-failure lines in the place dictionary end with a period

*Showboat demo for issue #445 (G06.10 phrase rule), created 2026-10-01.*

<!-- showboat-id: issue445-play-failed-periods -->

The judge review of PR #444 found that `playFailed` / `playFailedHint` in the
place detail dictionary kept their period-less wording while the same
dictionary's `refusalText` and the preview's `downloadFailed` read as phrases
(start with a capital, end with a period). The fix adds the periods to both
locales and extends the G06.10 guard over these two lines. This demo prints
the four rendered lines from the dictionary of the final HEAD and re-checks
them against the same phrase rule the guard uses — reverting either period in
any locale throws and the demo fails.

```sh
node --experimental-strip-types --input-type=module -e '
import { placeDetailStrings } from "./controllers/place/placeDetailController.ts";
const PHRASE_RULE = /^[A-ZА-ЯЁЎ].*\.$/;
for (const locale of ["be", "en"]) {
  const strings = placeDetailStrings(locale);
  console.log(locale + " playFailed: " + strings.playFailed);
  console.log(locale + " playFailedHint: " + strings.playFailedHint);
  if (!PHRASE_RULE.test(strings.playFailed) || !PHRASE_RULE.test(strings.playFailedHint)) {
    throw new Error(locale + ": play-failure lines violate the phrase rule");
  }
}
console.log("phrase rule: OK (issue #445)");
' 2>/dev/null
```

```output
be playFailed: Гук не пачаўся.
be playFailedHint: Паспрабуйце запусціць яшчэ раз.
en playFailed: The audio did not start.
en playFailedHint: Try starting it again.
phrase rule: OK (issue #445)
```
