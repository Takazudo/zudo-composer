"use client";

import { useEffect, useState } from "preact/hooks";

export type HostTheme = "light" | "dark";

export function resolveHostTheme(
  root: Element | null = globalThis.document?.documentElement ?? null,
): HostTheme {
  return root?.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export function useHostTheme(): HostTheme {
  const [theme, setTheme] = useState<HostTheme>(() => resolveHostTheme());

  useEffect(() => {
    const root = document.documentElement;
    const update = (): void => setTheme(resolveHostTheme(root));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}
