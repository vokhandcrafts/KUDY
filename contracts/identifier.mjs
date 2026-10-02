// The identifier shape owner: contracts/schemas/identifier.schema.json
// ([a-z0-9._-]{1,64}). tools/build-bundle and the web content readers both
// project this same pattern; specification verification-integration §V2
// gives the rule one owner in the contracts zone, so both sides import it
// from here instead of restating a second regex (G20.18, issue #489).
export const isIdentifier = (value) => typeof value === 'string' && /^[a-z0-9._-]{1,64}$/.test(value);
