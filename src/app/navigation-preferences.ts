import { formatIntent, parseIntent, type RouteIntent } from "./route-intents";

export type ContentNavigationTarget = Extract<RouteIntent, { route: "content" }>;
export interface NavigationModel {
  providerId: string;
  modelId: string;
  label: string;
  kind: "collection" | "single";
  views: readonly { id: string; label: string }[];
}
export interface NavigationPin { label: string; target: ContentNavigationTarget }
export const PINS_STORAGE_KEY = "zudo-composer-navigation-pins-v1";
export function preferenceStorage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}
/** Untrusted browser preferences never enter the authored project or review digest. */
export function readPins(storage = preferenceStorage()): NavigationPin[] {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(PINS_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    return raw.flatMap((value: unknown) => {
      if (!value || typeof value !== "object" || !("label" in value) || !("target" in value) || typeof value.label !== "string" || !value.label.trim() || value.label.length > 120) return [];
      try {
        const target = value.target as RouteIntent;
        const result = parseIntent(formatIntent(target));
        if (result.status !== "matched" || result.intent.route !== "content" || result.intent.entryId !== undefined) return [];
        const key = formatIntent(result.intent);
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ label: value.label.trim(), target: result.intent }];
      } catch { return []; }
    });
  } catch { return []; }
}
export function writePins(pins: readonly NavigationPin[], storage = preferenceStorage()): void {
  try { storage?.setItem(PINS_STORAGE_KEY, JSON.stringify(pins)); } catch { /* Preferences still work in memory. */ }
}
export function pinAvailable(pin: NavigationPin, models: readonly NavigationModel[]): boolean {
  const model = models.find((model) => model.providerId === pin.target.providerId && model.modelId === pin.target.modelId);
  return !!model && (pin.target.viewId === undefined || model.views.some((view) => view.id === pin.target.viewId));
}
