import { signal } from "@takazudo/zfb/zudo-react";
import { createChromeStore, type ChromeStore } from "../../../app/chrome-context";
import type { ProductionProviderIntegration } from "../../../app/provider-integration";
import type { AppServices } from "../../../app/services";

/** The route services a test mounts a Sitemapper surface with; page loading is not exercised. */
export function testServices({ integration, chrome = createChromeStore() }: { integration?: ProductionProviderIntegration; chrome?: ChromeStore } = {}): AppServices {
  return {
    workspace: {
      integration: integration as ProductionProviderIntegration,
      navigate: async () => true,
      reset: async () => true,
      open: async () => true,
      busy: signal(false),
      error: signal<string | null>(null),
    },
    chrome,
    pageLoading: null as unknown as AppServices["pageLoading"],
  };
}
