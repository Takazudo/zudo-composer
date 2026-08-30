export const THEME_STORAGE_KEY = "zudo-composer-theme";
export const DARK_THEME_QUERY = "(prefers-color-scheme: dark)";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export interface ThemeSnapshot {
  preference: ThemePreference;
  resolved: ResolvedTheme;
}

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface ThemeMediaQueryList {
  readonly matches: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
}

interface ThemeEventTarget {
  addEventListener(type: "storage", listener: (event: StorageEvent) => void): void;
  removeEventListener(type: "storage", listener: (event: StorageEvent) => void): void;
}

export interface ThemeEnvironment {
  root?: HTMLElement | null;
  storage?: ThemeStorage | null;
  matchMedia?: ((query: string) => ThemeMediaQueryList) | null;
  eventTarget?: ThemeEventTarget | null;
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function removeInvalidPreference(storage: ThemeStorage | null, value: string | null): void {
  if (!storage || value === null || isThemePreference(value)) return;
  try {
    storage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Storage is best-effort. Invalid data still resolves as System in memory.
  }
}

export function readThemePreference(storage: ThemeStorage | null = defaultStorage()): ThemePreference {
  if (!storage) return "system";
  try {
    const value = storage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(value)) return value;
    removeInvalidPreference(storage, value);
  } catch {
    // Privacy modes and embedded documents may expose a throwing Storage API.
  }
  return "system";
}

export function persistThemePreference(
  preference: ThemePreference,
  storage: ThemeStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    // "system" is a real user choice, not an alias for deleting the key.
    storage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The active document can still honor the choice when persistence is unavailable.
  }
}

export function resolveTheme(preference: ThemePreference, systemIsDark: boolean): ResolvedTheme {
  return preference === "system" ? (systemIsDark ? "dark" : "light") : preference;
}

export function applyTheme(root: HTMLElement | null, snapshot: ThemeSnapshot): void {
  if (!root) return;
  root.setAttribute("data-theme-preference", snapshot.preference);
  root.setAttribute("data-theme", snapshot.resolved);
}

function defaultRoot(): HTMLElement | null {
  return globalThis.document?.documentElement ?? null;
}

function defaultStorage(): ThemeStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function defaultMatchMedia(): ThemeEnvironment["matchMedia"] {
  return typeof globalThis.matchMedia === "function" ? globalThis.matchMedia.bind(globalThis) : null;
}

function defaultEventTarget(): ThemeEventTarget | null {
  return typeof globalThis.window?.addEventListener === "function" ? globalThis.window : null;
}

function readSystemQuery(matchMedia: ThemeEnvironment["matchMedia"]): ThemeMediaQueryList | null {
  if (!matchMedia) return null;
  try {
    return matchMedia(DARK_THEME_QUERY);
  } catch {
    return null;
  }
}

/** Synchronously applies both root attributes. Call before importing host CSS. */
export function bootstrapTheme(environment: ThemeEnvironment = {}): ThemeSnapshot {
  const root = environment.root === undefined ? defaultRoot() : environment.root;
  const storage = environment.storage === undefined ? defaultStorage() : environment.storage;
  const matchMedia = environment.matchMedia === undefined ? defaultMatchMedia() : environment.matchMedia;
  const preference = readThemePreference(storage);
  const resolved = resolveTheme(preference, readSystemQuery(matchMedia)?.matches ?? false);
  const snapshot = { preference, resolved };
  applyTheme(root, snapshot);
  return snapshot;
}

export interface ThemeController {
  getSnapshot(): ThemeSnapshot;
  setPreference(preference: ThemePreference): void;
  subscribe(listener: (snapshot: ThemeSnapshot) => void): () => void;
  dispose(): void;
}

/** Installs OS and cross-tab observers around an already-bootstrapped snapshot. */
export function createThemeController(
  initial: ThemeSnapshot,
  environment: ThemeEnvironment = {},
): ThemeController {
  const root = environment.root === undefined ? defaultRoot() : environment.root;
  const storage = environment.storage === undefined ? defaultStorage() : environment.storage;
  const matchMedia = environment.matchMedia === undefined ? defaultMatchMedia() : environment.matchMedia;
  const eventTarget = environment.eventTarget === undefined ? defaultEventTarget() : environment.eventTarget;
  const media = readSystemQuery(matchMedia);
  const listeners = new Set<(snapshot: ThemeSnapshot) => void>();
  let snapshot = initial;
  let disposed = false;

  const commit = (preference: ThemePreference): void => {
    const next = { preference, resolved: resolveTheme(preference, media?.matches ?? false) };
    const changed = next.preference !== snapshot.preference || next.resolved !== snapshot.resolved;
    snapshot = next;
    applyTheme(root, snapshot);
    if (changed) listeners.forEach((listener) => listener(snapshot));
  };
  const onSystemChange = (): void => {
    if (snapshot.preference === "system") commit("system");
  };
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== THEME_STORAGE_KEY) return;
    const preference = isThemePreference(event.newValue) ? event.newValue : "system";
    removeInvalidPreference(storage, event.newValue);
    commit(preference);
  };

  try {
    if (media?.addEventListener) media.addEventListener("change", onSystemChange);
    else media?.addListener?.(onSystemChange);
  } catch {
    // Observation is optional; the current resolved value remains valid.
  }
  try {
    eventTarget?.addEventListener("storage", onStorage);
  } catch {
    // Cross-tab synchronization is best-effort in restricted environments.
  }

  return {
    getSnapshot: () => snapshot,
    setPreference(preference) {
      if (disposed) return;
      persistThemePreference(preference, storage);
      commit(preference);
    },
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      try {
        if (media?.removeEventListener) media.removeEventListener("change", onSystemChange);
        else media?.removeListener?.(onSystemChange);
      } catch {
        // Match the best-effort listener installation above.
      }
      try {
        eventTarget?.removeEventListener("storage", onStorage);
      } catch {
        // Match the best-effort listener installation above.
      }
    },
  };
}
