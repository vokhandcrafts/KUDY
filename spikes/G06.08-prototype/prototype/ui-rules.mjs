// Pure UI-layer predicates shared by the browser prototype (app.js) and the
// headless walkthrough/tests, so a rule demonstrated in the UI has exactly one
// implementation and a failing-on-revert check (implementation rule 1).
// R07 quiet hint (docs/11_run_interaction.md §15): shown only in an Active
// session, with automation not suspended and the player fully idle — never
// while audio sounds or is paused, and never in Paused/Ended.
export const hintEligible = (s) => s.state === 'Active' && !s.suspended && !s.playing;
