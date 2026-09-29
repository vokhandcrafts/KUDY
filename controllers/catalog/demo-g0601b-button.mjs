// G06.01.b (issue #314) — Showboat driver (the single main button): the
// pure derivePreviewButton over the real package facts — the 09 §7
// inventory states and the contentRepo verify verdicts — renders the
// Download/Start meanings (09 §6.5, 11 §7). The facts' inputs here mirror
// the assembled preview of demo-g0601b-preview.mjs (the assembly demo lives
// in services/, this table beside the controller — controllers/
// value-imports services/ only in the composition root, 19 §2.2).
// G06.05 (issue #280): the derivation produces verbatim codes; the words
// render through previewStrings per locale (the runMapReason idiom), the
// display locale here is the composition root's first preference.
// Deterministic: fixed inputs, no clocks, no randomness.
import { derivePreviewButton, previewReasonText, previewStrings } from './previewController.ts';

const strings = previewStrings('be');
const READY_VERIFY = { status: 'ready', routeId: 'r', version: '1', tier: 'base', tierAvailable: ['base'] };

const buttonLine = (name, button) =>
  console.log(
    `button ${name}: action=${button.action} enabled=${button.enabled} label="${strings.label[button.label]}"` +
      ` reason=${button.reason ? previewReasonText(button.reason, strings) : '-'}` +
      ` detail=${button.detail ? strings.detail(button.detail) : '-'}`,
  );

// A paid guide without an entitlement: Start disabled with its reason —
// the preview buys nothing (AC2, NAV6).
buttonLine(
  'paid-no-entitlement',
  derivePreviewButton({
    access: 'paid',
    granted: false,
    layer: { state: 'ready', missingCount: null },
    verify: READY_VERIFY,
    canDownload: true,
  }),
);

// The four inventory states (09 §7): Download while the base layer is not
// fully on disk, Start when ready and verified — and the verify failure
// keeps Start unavailable with the reason shown (AC3, AC5, 11 §7).
buttonLine(
  'not_downloaded',
  derivePreviewButton({
    access: 'free',
    granted: true,
    layer: { state: 'not_downloaded', missingCount: null },
    verify: null,
    canDownload: true,
  }),
);
buttonLine(
  'partial',
  derivePreviewButton({
    access: 'free',
    granted: true,
    layer: { state: 'partial', missingCount: 3 },
    verify: null,
    canDownload: true,
  }),
);
buttonLine(
  'ready-verified',
  derivePreviewButton({
    access: 'free',
    granted: true,
    layer: { state: 'ready', missingCount: null },
    verify: READY_VERIFY,
    canDownload: true,
  }),
);
buttonLine(
  'verify-failure',
  derivePreviewButton({
    access: 'free',
    granted: true,
    layer: { state: 'ready', missingCount: null },
    verify: { status: 'needs-recovery', media: ['audio/s2.m4a'] },
    canDownload: true,
  }),
);
