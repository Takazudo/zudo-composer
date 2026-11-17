import type { ComposerConfig } from "./config";

export declare function defineComposerConfig(config: ComposerConfig): ComposerConfig;

export type {
  ComposerConfig,
  ComposerConfigInput,
  ComposerConfigOverrides,
  ComposerPaths,
  ComposerRuntime,
  ResolvedComposerConfig,
  NativeEditingConfig,
  AssistantConfig,
  HostDocumentConfig,
  ContentValidationConfig,
} from "./config";
export type { ComposerSettingDefaults, ComposerSettings } from "./settings";
