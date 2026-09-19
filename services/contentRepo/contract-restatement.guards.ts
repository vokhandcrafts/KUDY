// TR-5 level 1 — compile-time contract guards for the services restatement
// (docs/architecture/23_technical_remarks.md). Behavioral tests cannot pin an
// enum domain that the type already rejects, so the domain is asserted here:
// every @ts-expect-error line fails the tsc run on its own the moment the
// guarded drift returns (implementation-rules 1). Runs in `npm run typecheck`
// (tsc -p services) and in the CI lint job.
import type { RouteAccess } from './types.ts';

// route.schema.json:13 — access = free_base | paid. 'free' is not in the
// domain; the pre-TR-3 reader accepted it and read schema-valid free_base
// packages as incomplete.
// @ts-expect-error — 'free' is not in the route.schema.json access enum.
const legacyFree: RouteAccess = 'free';

export const schemaDomain: [RouteAccess, RouteAccess] = ['free_base', 'paid'];
export const guarded = [legacyFree, ...schemaDomain];
