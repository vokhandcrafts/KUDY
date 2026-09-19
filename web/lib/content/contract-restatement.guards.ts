// TR-5 level 1 — compile-time contract guards for the web restatement of
// contracts/schemas/ (docs/architecture/23_technical_remarks.md). Behavioral
// tests cannot see required-ness (the web reader re-validates at runtime, so
// dropping a required field keeps every test green), which is exactly the
// class key-parity cannot catch either. Every @ts-expect-error line fails the
// tsc run on its own the moment the guarded drift returns (implementation-rules
// 1). Runs in the CI lint job (`npx tsc --noEmit -p web`) and locally.
import type { CatalogRouteEntry, RouteDoc } from './types.ts';

// catalog.schema.json — routes[].sizes is required and requires base (09 §4).
// @ts-expect-error — sizes is required by catalog.schema.json; a "unused directive" report means the restatement lost the required field.
const entryWithoutSizes: CatalogRouteEntry = { route_id: 'route-x', version: '1', locales: ['be'], layers: ['base'] };

// route.schema.json — access = free_base | paid; 'free' is not in the domain.
// @ts-expect-error — 'free' is not in the route.schema.json access enum.
const legacyAccess: RouteDoc['access'] = 'free';

export const guarded = [entryWithoutSizes, legacyAccess];
