import { useEffect, useState } from "preact/hooks";
import type { ResolvedTheme } from "./theme";

export function resolveRootTheme(
  root: Element | null = globalThis.document?.documentElement ?? null,
): ResolvedTheme {
  return root?.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

/** Observe the single resolved host-theme attribute shared by preview consumers. */
export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>(() => resolveRootTheme());

  useEffect(() => {
    const root = globalThis.document?.documentElement;
    if (!root || typeof MutationObserver === "undefined") return;
    const update = (): void => setTheme(resolveRootTheme(root));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}
