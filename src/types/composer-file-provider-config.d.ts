declare module "virtual:composer-file-provider-config" {
  import type { ComposerFileProviderConfig } from "../composer/storage/file-provider/types";

  export const fileProviderConfig: ComposerFileProviderConfig | undefined;
}
