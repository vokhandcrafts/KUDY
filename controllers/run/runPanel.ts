// G06.03 (issue #279) — the Run panel's state model, framework-free: three
// positions (Peek/Half/Full, 11 §6) and the card the panel shows. Panel
// position and inspected are UI state in the run controller — never the
// engine's (11 §11): opening, expanding and closing the card dispatches
// nothing to the engine and commands nothing to the audio owner. The
// controller's actions adapt its flat store fields onto these transitions —
// this file is their single source; the surface renders its own words from
// runMapStrings.
export type RunPanelPosition = 'peek' | 'half' | 'full';

export interface RunPanelState {
  readonly position: RunPanelPosition;
  // The card the panel shows — «што апошняе адкрывалі» (11 §3.2): closing
  // the panel keeps it, opening another card replaces it. It never touches
  // the engine's heard set — peeking is not listening (criterion 5).
  readonly inspected: string | null;
}

export const initialPanelState: RunPanelState = { position: 'peek', inspected: null };

// Peek → Half: a marker tap (11 §3.2). Above Peek the position holds — the
// panel never jumps to Full on its own. Re-opening the open card changes
// nothing (no re-render churn).
export function panelOpened(panel: RunPanelState, stopId: string): RunPanelState {
  if (panel.inspected === stopId && panel.position !== 'peek') return panel;
  return { position: panel.position === 'peek' ? 'half' : panel.position, inspected: stopId };
}

// One position up (the card's explicit expand): Peek → Half → Full.
export function panelRaised(panel: RunPanelState): RunPanelState {
  if (panel.position === 'peek') return { ...panel, position: 'half' };
  if (panel.position === 'half') return { ...panel, position: 'full' };
  return panel;
}

// ✕ and Back share one close step (11 §6 — identical, never two behaviors):
// Full → Half → Peek. `inspected` stays — «што апошняе адкрывалі» (11 §3.2).
// At Peek the panel is already closed — a no-op.
export function panelClosed(panel: RunPanelState): RunPanelState {
  if (panel.position === 'peek') return panel;
  return { ...panel, position: panel.position === 'full' ? 'half' : 'peek' };
}
