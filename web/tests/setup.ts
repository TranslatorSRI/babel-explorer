import { beforeEach } from 'vitest';

/**
 * In-memory localStorage and sessionStorage for every test file.
 *
 * The happy-dom environment here leaves both undefined, and the instance selector
 * remembers its selection in each. Installed with defineProperty rather than
 * vi.stubGlobal so the vi.unstubAllGlobals() many tests run in afterEach does not
 * remove them; cleared before each test so one test's selection is never the next
 * one's starting point.
 */
class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  get length() { return this.items.size; }
  clear() { this.items.clear(); }
  getItem(key: string) { return this.items.get(key) ?? null; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  removeItem(key: string) { this.items.delete(key); }
  setItem(key: string, value: string) { this.items.set(key, String(value)); }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  Object.defineProperty(globalThis, name, {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
