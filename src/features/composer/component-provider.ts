import type {
  ComponentManifest,
  RuntimeComponentEntry,
  TrustedComponentPack,
} from "@zudo-composer/component-contract";
import { validateRuntimeParity } from "@zudo-composer/component-contract";
import { createComponentCatalog, type ComponentCatalog } from "./headless-api";

export interface ComposerRuntimeEntry {
  manifest: ComponentManifest;
  runtime: RuntimeComponentEntry;
}

/** One validated view shared by the editor, source generator, and preview. */
export interface ComposerComponentProvider {
  pack: TrustedComponentPack;
  manifest: TrustedComponentPack["manifest"];
  catalog: ComponentCatalog;
  runtimeEntries: readonly ComposerRuntimeEntry[];
}

export function createComposerComponentProvider(pack: TrustedComponentPack): ComposerComponentProvider {
  const trusted = validateRuntimeParity(pack.manifest, pack.runtime);
  const catalog = createComponentCatalog(trusted.manifest);
  const runtimeEntries = trusted.manifest.components.map((manifest) => ({
    manifest,
    runtime: trusted.runtime.components[manifest.id]!,
  }));
  return Object.freeze({ pack: trusted, manifest: trusted.manifest, catalog, runtimeEntries });
}
