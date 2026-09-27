// The in-memory BundlesStore fake shared by the service-wired demo drivers
// (G06.04): the same seam the device adapter implements — listDir answers
// null for "nothing here" (09 §7).
export function memoryBundles(files: Record<string, string>) {
  return {
    listDir: async (rel: string) => {
      const prefix = rel.endsWith('/') ? rel : `${rel}/`;
      const names = new Set<string>();
      for (const key of Object.keys(files)) {
        if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split('/')[0]);
      }
      return names.size > 0 ? [...names] : null;
    },
    readFile: async (rel: string) =>
      files[rel] === undefined
        ? { kind: 'absent' as const }
        : { kind: 'present' as const, bytes: new TextEncoder().encode(files[rel]) },
    statSize: async () => null,
  };
}
