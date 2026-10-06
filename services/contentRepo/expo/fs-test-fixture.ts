// G20.20 — the fake File/Directory surface the store tests and the
// composition integration test inject: an in-memory tree with just the API
// the adapters use (the Expo/OS boundary, V1). '/'-segregated posix paths.
export interface MemoryFs {
  files: Map<string, Uint8Array>;
  dirs: Set<string>;
}

export function makeFakeFs(): MemoryFs {
  return { files: new Map(), dirs: new Set(['/root']) };
}

const join = (base: string, segments: readonly string[]) =>
  [base, ...segments].join('/').replace(/\/+/g, '/');

class Entry {
  path: string;
  constructor(...parts: Array<Entry | string>) {
    const base = parts[0] instanceof Entry ? parts[0].path : '/';
    const segments = parts.filter((part): part is string => typeof part === 'string');
    this.path = join(base, segments);
  }
  get name(): string {
    return this.path.slice(this.path.lastIndexOf('/') + 1);
  }
}

class FakeFile extends Entry {
  fs: MemoryFs;
  constructor(fs: MemoryFs, ...parts: Array<Entry | string>) {
    super(...parts);
    this.fs = fs;
  }
  get exists(): boolean {
    return this.fs.files.has(this.path);
  }
  get size(): number {
    return this.fs.files.get(this.path)?.byteLength ?? 0;
  }
  async bytes(): Promise<Uint8Array> {
    const bytes = this.fs.files.get(this.path);
    if (bytes === undefined) throw new Error(`noent ${this.path}`);
    return bytes;
  }
  write(content: Uint8Array, _options?: { encoding?: string }): void {
    this.fs.files.set(this.path, content);
    this.ancestors().forEach((dir) => this.fs.dirs.add(dir));
  }
  delete(): void {
    this.fs.files.delete(this.path);
  }
  move(destination: FakeFile | FakeDirectory): void {
    const bytes = this.fs.files.get(this.path);
    if (bytes === undefined) throw new Error(`noent ${this.path}`);
    this.fs.files.delete(this.path);
    this.fs.files.set(destination.path, bytes);
  }
  ancestors(): string[] {
    const out: string[] = [];
    for (let dir = this.path.slice(0, this.path.lastIndexOf('/')); dir !== '/' && dir !== ''; dir = dir.slice(0, dir.lastIndexOf('/')) || '/') {
      out.push(dir);
    }
    return out;
  }
}

class FakeDirectory extends Entry {
  fs: MemoryFs;
  constructor(fs: MemoryFs, ...parts: Array<Entry | string>) {
    super(...parts);
    this.fs = fs;
  }
  get exists(): boolean {
    return this.fs.dirs.has(this.path);
  }
  create(options?: { idempotent?: boolean; intermediates?: boolean }): void {
    if (this.fs.dirs.has(this.path)) {
      if (options?.idempotent === true) return;
      throw new Error(`exists ${this.path}`);
    }
    new FakeFile(this.fs, this.path).ancestors().forEach((dir) => this.fs.dirs.add(dir));
    this.fs.dirs.add(this.path);
  }
  delete(): void {
    for (const key of [...this.fs.files.keys()]) {
      if (key.startsWith(`${this.path}/`)) this.fs.files.delete(key);
    }
    for (const dir of [...this.fs.dirs]) {
      if (dir === this.path || dir.startsWith(`${this.path}/`)) this.fs.dirs.delete(dir);
    }
  }
  move(destination: FakeFile | FakeDirectory): void {
    if (!this.fs.dirs.has(this.path)) throw new Error(`noent ${this.path}`);
    const target = destination.path;
    for (const key of [...this.fs.files.keys()]) {
      if (key.startsWith(`${this.path}/`)) {
        this.fs.files.set(`${target}${key.slice(this.path.length)}`, this.fs.files.get(key)!);
        this.fs.files.delete(key);
      }
    }
    for (const dir of [...this.fs.dirs]) {
      if (dir === this.path || dir.startsWith(`${this.path}/`)) {
        this.fs.dirs.add(`${target}${dir.slice(this.path.length)}`);
        this.fs.dirs.delete(dir);
      }
    }
  }
  list(): Array<{ name: string }> {
    const names: string[] = [];
    for (const dir of this.fs.dirs) {
      if (dir.slice(0, dir.lastIndexOf('/')) === this.path && this.path !== dir) names.push(dir.slice(dir.lastIndexOf('/') + 1));
    }
    for (const file of this.fs.files.keys()) {
      if (file.slice(0, file.lastIndexOf('/')) === this.path) names.push(file.slice(file.lastIndexOf('/') + 1));
    }
    return names.map((name) => ({ name }));
  }
}

// The module shape the adapters' injected classes come from (the app root
// passes the real expo-file-system classes; tests pass these).
export function makeFakeFsModule(fs: MemoryFs): {
  File: new (...parts: Array<Entry | string>) => FakeFile;
  Directory: new (...parts: Array<Entry | string>) => FakeDirectory;
  Paths: { document: FakeDirectory; availableDiskSpace: number };
} {
  class BoundFile extends FakeFile {
    constructor(...parts: Array<Entry | string>) {
      super(fs, ...parts);
    }
  }
  class BoundDirectory extends FakeDirectory {
    constructor(...parts: Array<Entry | string>) {
      super(fs, ...parts);
    }
  }
  return {
    File: BoundFile,
    Directory: BoundDirectory,
    Paths: { document: new BoundDirectory('/root'), availableDiskSpace: 1_000_000 },
  };
}
