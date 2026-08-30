"use client";

import { resolveRootTheme, useResolvedTheme } from "../../../theme/use-resolved-theme";

export type HostTheme = "light" | "dark";

export function resolveHostTheme(
  root: Element | null = globalThis.document?.documentElement ?? null,
): HostTheme {
  return resolveRootTheme(root);
}

export function useHostTheme(): HostTheme {
  return useResolvedTheme();
}
