import type { FileProviderConfig } from "../shared/file-provider";

/** Unit specs construct their own transport; the virtual module stays empty. */
export const domainProviderConfig: { domains: Record<string, FileProviderConfig> } | undefined = undefined;
