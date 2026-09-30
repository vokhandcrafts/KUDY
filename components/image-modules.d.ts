// G06.10.e (issue #405) — Metro bundles image imports as opaque asset
// modules; the paper-surface wrapper consumes the generated grain tile
// through this module shape.
declare module "*.png" {
  const value: number;
  export default value;
}
