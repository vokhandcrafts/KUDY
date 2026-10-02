// Synthetic negative fixture (G20.16): the catch swallows the failure with an
// empty block, so malformed input disappears silently. The guard lints this
// file with --no-ignore and requires the check to reject it naming no-empty.
export function parseCount(raw) {
  try {
    return JSON.parse(raw).count;
  } catch (error) {}
}
