// The shared safe-unit idiom (implementation-rules 3): one implementation of
// the 09 §7 filesystem-input checks — reused by the inventory, the download
// deletion/activation and the catalog service instead of a second variant.
// Node-free by constraint: the value chain app → controllers/createServices
// reaches this module in the device bundle (issue #338), so absoluteness is
// expressed without path.isAbsolute. Every absolute form requires a
// separator (POSIX a leading '/', Windows a leading '\\' or a drive letter
// before one), so the separator checks subsume the POSIX case; the drive
// «C:/» case is rejected explicitly, on every platform — where
// path.isAbsolute accepted it on POSIX.

// 09 §7: identifiers reaching the filesystem are untrusted input and are
// checked as safe path segments (no separators, no '..', no NUL) on input.
// Catalog-sourced strings are exactly that. Disk-sourced names come from
// readdir and cannot contain separators, so they are used as listed; the
// adapter still owns confinement, as for PackageStore.
export function isSafeSegment(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('/') &&
    !value.includes('\\') && !value.includes('\0') &&
    value !== '.' && value !== '..';
}

// A lock path is a multi-segment rel path inside the layer directory:
// '/'-separated (validate-package idiom — the fs APIs accept '/' everywhere),
// never absolute, no traversal segments, no NUL.
export function isSafeRel(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\\') &&
    !value.includes('\0') && !value.startsWith('/') && !/^[A-Za-z]:\//.test(value) &&
    value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}
