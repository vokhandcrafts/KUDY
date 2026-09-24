// G05.02.a — great-circle distance in meters (19 §2.1: `core/geo` is pure,
// stateless, coordinates in → meters out). The idiom — formula, argument
// order and the IUGG mean radius — is copied from the existing sibling
// implementation in tools/validate/validate-package.mjs (implementation-rules
// 3); core/ cannot import across zones, so the two stay identical by this
// anchor comment, reviewed together.

const EARTH_RADIUS_M = 6371008.8;

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}
