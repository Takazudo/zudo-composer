/**
 * Show slug / Show count persistence.
 *
 * Namespaced by the caller's `prefKey` so the Sitemapper, Content and Composer
 * trees remember their own choices. Every access is guarded: blocked or
 * private-mode storage degrades to the defaults rather than throwing, the same
 * rule the Composer's viewport and rail widths follow.
 */

export interface OutlinePrefs {
  slug: boolean;
  count: boolean;
}

/** Both columns start visible, which is what the outline is designed around. */
export const DEFAULT_OUTLINE_PREFS: OutlinePrefs = { slug: true, count: true };

export function outlinePrefsStorageKey(prefKey: string): string {
  return `zudo-composer-outline-tree:${prefKey}`;
}

export function readOutlinePrefs(prefKey: string | undefined): OutlinePrefs {
  if (prefKey === undefined) return DEFAULT_OUTLINE_PREFS;
  try {
    const raw = localStorage.getItem(outlinePrefsStorageKey(prefKey));
    if (raw === null) return DEFAULT_OUTLINE_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_OUTLINE_PREFS;
    const record = parsed as Partial<Record<keyof OutlinePrefs, unknown>>;
    return {
      slug: typeof record.slug === "boolean" ? record.slug : DEFAULT_OUTLINE_PREFS.slug,
      count: typeof record.count === "boolean" ? record.count : DEFAULT_OUTLINE_PREFS.count,
    };
  } catch {
    return DEFAULT_OUTLINE_PREFS;
  }
}

export function writeOutlinePrefs(prefKey: string | undefined, prefs: OutlinePrefs): void {
  if (prefKey === undefined) return;
  try {
    localStorage.setItem(outlinePrefsStorageKey(prefKey), JSON.stringify(prefs));
  } catch {
    /* Storage is unavailable; the choice simply does not survive a reload. */
  }
}
