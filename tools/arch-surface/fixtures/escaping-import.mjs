// Fixture for the tools/arch-surface test (G18.03): sits OUTSIDE the scanned
// `fixtures/sample/` directory so that beta.mjs's `../escaping-import.mjs`
// specifier is a real escaping-relative import. Scanned when the fixture root
// itself is scanned; never executed.
export const upValue = 'up';
