import type { Page } from "@playwright/test";

export function readBodyBackgroundProbe(
  page: Page,
  colorScheme: "light" | "dark",
): Promise<{ body: string; probe: string }>;
