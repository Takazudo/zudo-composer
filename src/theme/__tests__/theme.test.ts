import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DARK_THEME_QUERY,
  THEME_STORAGE_KEY,
  bootstrapTheme,
  createThemeController,
  persistThemePreference,
  type ThemeStorage,
} from "../theme";

function storage(value: string | null = null) {
  return {
    getItem: vi.fn<(key: string) => string | null>(() => value),
    setItem: vi.fn<(key: string, value: string) => void>(),
    removeItem: vi.fn<(key: string) => void>(),
  } satisfies ThemeStorage;
}

function media(initial = false) {
  let matches = initial;
  let listener: (() => void) | undefined;
  return {
    query: {
      get matches() { return matches; },
      addEventListener: vi.fn((_type: "change", next: () => void) => { listener = next; }),
      removeEventListener: vi.fn(),
    },
    change(next: boolean) { matches = next; listener?.(); },
  };
}

function eventTarget() {
  let listener: ((event: StorageEvent) => void) | undefined;
  return {
    target: {
      addEventListener: vi.fn((_type: "storage", next: (event: StorageEvent) => void) => { listener = next; }),
      removeEventListener: vi.fn(),
    },
    emit(key: string | null, newValue: string | null) {
      listener?.({ key, newValue } as StorageEvent);
    },
  };
}

afterEach(() => {
  document.documentElement.removeAttribute("data-theme-preference");
  document.documentElement.removeAttribute("data-theme");
});

describe("theme bootstrap", () => {
  it.each([
    [null, false, "system", "light"],
    [null, true, "system", "dark"],
    ["system", true, "system", "dark"],
    ["light", true, "light", "light"],
    ["dark", false, "dark", "dark"],
  ] as const)("applies stored %s with system dark=%s", (stored, dark, preference, resolved) => {
    const root = document.documentElement;
    const result = bootstrapTheme({ root, storage: storage(stored), matchMedia: () => ({ matches: dark }) });
    expect(result).toEqual({ preference, resolved });
    expect(root.dataset.themePreference).toBe(preference);
    expect(root.dataset.theme).toBe(resolved);
  });

  it("removes invalid persisted values best-effort and uses System", () => {
    const invalid = storage("sepia");
    const result = bootstrapTheme({ storage: invalid, matchMedia: () => ({ matches: true }) });
    expect(result).toEqual({ preference: "system", resolved: "dark" });
    expect(invalid.removeItem).toHaveBeenCalledWith(THEME_STORAGE_KEY);
  });

  it("falls back to System/light when storage or matchMedia throws", () => {
    const throwingStorage = storage();
    throwingStorage.getItem.mockImplementation(() => { throw new Error("blocked"); });
    expect(() => bootstrapTheme({ storage: throwingStorage, matchMedia: () => { throw new Error("blocked"); } })).not.toThrow();
    expect(document.documentElement.dataset.themePreference).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("falls back to System/light when APIs are unavailable", () => {
    expect(bootstrapTheme({ storage: null, matchMedia: null })).toEqual({ preference: "system", resolved: "light" });
  });

  it("persists the literal System choice", () => {
    const target = storage();
    persistThemePreference("system", target);
    expect(target.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, "system");
  });
});

describe("theme controller", () => {
  it("follows OS changes only while the preference is System", () => {
    const system = media(false);
    const target = storage("system");
    const controller = createThemeController(
      bootstrapTheme({ storage: target, matchMedia: () => system.query }),
      { storage: target, matchMedia: () => system.query, eventTarget: null },
    );
    expect(system.query.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    expect(document.documentElement.dataset.theme).toBe("light");
    system.change(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    controller.setPreference("light");
    system.change(false);
    system.change(true);
    expect(controller.getSnapshot()).toEqual({ preference: "light", resolved: "light" });
    expect(target.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, "light");
    controller.dispose();
  });

  it("synchronizes valid, removed, and invalid cross-tab values", () => {
    const system = media(true);
    const storageTarget = storage("light");
    const events = eventTarget();
    const controller = createThemeController(
      bootstrapTheme({ storage: storageTarget, matchMedia: () => system.query }),
      { storage: storageTarget, matchMedia: () => system.query, eventTarget: events.target },
    );
    events.emit(THEME_STORAGE_KEY, "dark");
    expect(controller.getSnapshot()).toEqual({ preference: "dark", resolved: "dark" });
    events.emit(THEME_STORAGE_KEY, null);
    expect(controller.getSnapshot()).toEqual({ preference: "system", resolved: "dark" });
    events.emit(THEME_STORAGE_KEY, "sepia");
    expect(controller.getSnapshot()).toEqual({ preference: "system", resolved: "dark" });
    expect(storageTarget.removeItem).toHaveBeenCalledWith(THEME_STORAGE_KEY);
    events.emit("another-key", "light");
    expect(controller.getSnapshot().preference).toBe("system");
    controller.dispose();
  });

  it("requests the canonical media query and tolerates listener failures", () => {
    const matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener: () => { throw new Error("blocked"); },
      removeEventListener: () => { throw new Error("blocked"); },
    }));
    const controller = createThemeController(
      { preference: "system", resolved: "light" },
      { matchMedia, eventTarget: null, storage: null },
    );
    expect(matchMedia).toHaveBeenCalledWith(DARK_THEME_QUERY);
    expect(() => controller.dispose()).not.toThrow();
  });
});
