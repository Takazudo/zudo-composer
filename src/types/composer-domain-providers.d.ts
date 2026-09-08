declare module "virtual:composer-domain-providers" {
  type FileProviderConfig = import("../shared/file-provider").FileProviderConfig;

  /**
   * Emitted only by a development server. A production build emits `undefined`,
   * so a domain with no other provider must report that it is unavailable.
   */
  export const domainProviderConfig: { domains: Record<string, FileProviderConfig> } | undefined;
}
