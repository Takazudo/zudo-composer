import { componentPack } from "@zudo-sg/ui/composer-pack";
import { createComposerComponentProvider } from "./component-provider";

/** The sole production component-pack selection point. */
export const activeComponentPack = componentPack;
export const activeComponentProvider = createComposerComponentProvider(componentPack);
export const activeComponentManifest = activeComponentProvider.manifest;
export const activeComponentRuntime = activeComponentProvider.pack.runtime;

export type { ComponentManifest as ComponentDefinition } from "@zudo-composer/component-contract";
export type { ComposerComponentProvider, ComposerRuntimeEntry } from "./component-provider";
export { createComposerComponentProvider } from "./component-provider";
