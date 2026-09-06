declare module "virtual:composer-domain-providers" {
  import type { FileProviderConfig } from "../shared/file-provider";

  /**
   * Emitted only by a development server. A production build emits `undefined`,
   * so a domain with no other provider must report that it is unavailable.
   */
  export const domainProviderConfig: { domains: Record<string, FileProviderConfig> } | undefined;
}
