"use client";

// Mirrors the host document's light/dark scheme into the preview session
// (issue Takazudo/zudo-sg#251). The doc chrome sets `data-theme` on `<html>` (the color-scheme
// bootstrap; same attribute the design-token panel reads, see
// src/lib/design-token-panel-bootstrap.ts). The preview iframe renders the real
// component library, so it must follow the same scheme — that theme is one
// third of the `PreviewSession` snapshot the bridge sends.

import { useEffect, useState } from "preact/hooks";
import type { PreviewTheme } from "../preview";

/** Resolve the host document's current theme. Defaults to light off-DOM. */
export function resolveHostTheme(
  root: Element | null = globalThis.document?.documentElement ?? null,
): PreviewTheme {
  return root?.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

/** Track the host `<html data-theme>` and re-render when the user toggles it. */
export function useHostTheme(): PreviewTheme {
  const [theme, setTheme] = useState<PreviewTheme>(() => resolveHostTheme());

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
