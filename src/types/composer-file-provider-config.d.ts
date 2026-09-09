declare module "virtual:composer-file-provider-config" {
  type ComposerFileProviderConfig = import("../composer/storage/file-provider/types").ComposerFileProviderConfig;
  type AssetFileProviderConfig = import("../assets/storage/file-provider/types").AssetFileProviderConfig;

  export const fileProviderConfig: (ComposerFileProviderConfig & AssetFileProviderConfig) | undefined;
}
