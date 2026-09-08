declare module "virtual:composer-file-provider-config" {
  type ComposerFileProviderConfig = import("../composer/storage/file-provider/types").ComposerFileProviderConfig;
  type MediaFileProviderConfig = import("../media/storage/file-provider/types").MediaFileProviderConfig;

  export const fileProviderConfig: (ComposerFileProviderConfig & MediaFileProviderConfig) | undefined;
}
