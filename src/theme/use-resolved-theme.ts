import { signal, type ReadonlySignal, type Scope } from "@takazudo/zfb/zudo-react";
import type { ResolvedTheme } from "./theme";

export function resolveRootTheme(
  root: Element | null = globalThis.document?.documentElement ?? null,
): ResolvedTheme {
  return root?.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

/**
 * Observe the single resolved host-theme attribute shared by preview consumers,
 * as a signal owned by `scope` (the observer starts on activation).
 */
export function resolvedThemeSignal(scope: Scope): ReadonlySignal<ResolvedTheme> {
  const theme = signal<ResolvedTheme>(resolveRootTheme());
  scope.onActivate(() => {
    const root = globalThis.document?.documentElement;
    if (!root || typeof MutationObserver === "undefined") return undefined;
    const update = (): void => { theme.value = resolveRootTheme(root); };
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  });
  return theme;
}
