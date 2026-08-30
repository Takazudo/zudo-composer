"use client";

// Mirrors the host document's light/dark scheme into the preview session
// (issue Takazudo/zudo-sg#251). The doc chrome sets `data-theme` on `<html>` (the color-scheme
// bootstrap; same attribute the design-token panel reads, see
// src/lib/design-token-panel-bootstrap.ts). The preview iframe renders the real
// component library, so it must follow the same scheme — that theme is one
// third of the `PreviewSession` snapshot the bridge sends.

import type { PreviewTheme } from "../preview";
import { resolveRootTheme, useResolvedTheme } from "../../../theme/use-resolved-theme";

/** Resolve the host document's current theme. Defaults to light off-DOM. */
export function resolveHostTheme(
  root: Element | null = globalThis.document?.documentElement ?? null,
): PreviewTheme {
  return resolveRootTheme(root);
}

/** Track the host `<html data-theme>` and re-render when the user toggles it. */
export function useHostTheme(): PreviewTheme {
  return useResolvedTheme();
}
