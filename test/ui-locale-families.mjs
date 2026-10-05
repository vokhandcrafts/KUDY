// The one import surface for the locale-render suites (the registry test's
// families idiom, G21.09 #542 criterion 5): every native selector family plus
// the generated guide-hint data module (GuideHintCard.tsx is JSX — node
// cannot import it, the golden test's idiom) and the two reason routers.
// G21.12 (issue #546): extracted when the fr suite joined the de suite —
// the selector imports live here once instead of being cloned per locale
// (AGENTS.md: on a jscpd fail, refactor or reuse).
import { uiStrings } from '../components/ui-strings.ts';
import { GUIDE_HINT_STRINGS } from '../components/guide-hint-strings.generated.ts';
import { previewReasonText, previewStrings } from '../controllers/catalog/previewController.ts';
import { runMapReason, runMapStrings } from '../controllers/run/runMap.ts';
import { placeDetailStrings } from '../controllers/place/placeDetailController.ts';
import { nearbyStrings } from '../controllers/nearby/nearbySurfaceController.ts';
import { offerStrings } from '../controllers/commerce/commerceController.ts';
import { feedbackStrings } from '../controllers/useFeedbackController.ts';

// The native selector families of one locale, plus the two reason routers
// (they take the family's own catalogue as their second argument).
export function localeFamilies(locale) {
  return {
    chrome: uiStrings(locale),
    guideHint: GUIDE_HINT_STRINGS[locale],
    preview: previewStrings(locale),
    previewReasonText,
    run: runMapStrings(locale),
    runReason: runMapReason,
    place: placeDetailStrings(locale),
    nearby: nearbyStrings(locale),
    offer: offerStrings(locale),
    feedback: feedbackStrings(locale),
  };
}
