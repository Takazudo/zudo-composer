import type { Child } from "@takazudo/zfb/zudo-react";
import type { CompositionDocument } from "../../composer/model/types";
import type { VersionedAssetStore } from "../../assets/library";
import type { MaybeSignal } from "../../components/reactive";
import type { ComposerComponentProvider } from "../composer/component-provider";
import { CompositionPreviewHost, createComposerPreviewBridge, type ComposerPreviewLocation, type MessageTarget } from "../composer/preview";

export interface MappingPreviewHostProps {
  componentProvider: ComposerComponentProvider;
  document: MaybeSignal<CompositionDocument | null>;
  loading?: MaybeSignal<boolean>;
  /** Keep the feature's preview chrome on the shared fullscreen host. */
  enlargeable?: boolean;
  onCurrent?: MaybeSignal<(() => void) | undefined>;
  onError?: MaybeSignal<((message: string) => void) | undefined>;
  assetStore?: VersionedAssetStore;
  createBridge?: typeof createComposerPreviewBridge;
  location?: ComposerPreviewLocation;
  hostWindow?: MessageTarget;
}

/** Dedicated read-only bridge host. Only resolved Composition JSON crosses into the preview chunk. */
export function MappingPreviewHost({ componentProvider, document, loading = false, enlargeable = true, onCurrent, onError, assetStore, createBridge = createComposerPreviewBridge, location: suppliedLocation, hostWindow }: MappingPreviewHostProps): Child {
  return <CompositionPreviewHost
    componentProvider={componentProvider}
    document={document}
    loading={loading}
    title="Resolved Mapping preview"
    emptyMessage="Choose a valid Composition and sample Entry to render a resolved preview."
    enlargeable={enlargeable}
    onCurrent={onCurrent}
    onError={onError}
    assetStore={assetStore}
    createBridge={createBridge}
    location={suppliedLocation}
    hostWindow={hostWindow}
  />;
}
