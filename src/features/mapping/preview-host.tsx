import type { JSX } from "preact";
import type { CompositionDocument } from "../../composer/model/types";
import type { ComposerComponentProvider } from "../composer/component-provider";
import { CompositionPreviewHost, createComposerPreviewBridge, type ComposerPreviewLocation, type MessageTarget } from "../composer/preview";

export interface MappingPreviewHostProps {
  componentProvider: ComposerComponentProvider;
  document: CompositionDocument | null;
  loading?: boolean;
  /** Keep the feature's preview chrome on the shared fullscreen host. */
  enlargeable?: boolean;
  onCurrent?: () => void;
  onError?: (message: string) => void;
  createBridge?: typeof createComposerPreviewBridge;
  location?: ComposerPreviewLocation;
  hostWindow?: MessageTarget;
}

/** Dedicated read-only bridge host. Only resolved Composition JSON crosses into the preview chunk. */
export function MappingPreviewHost({ componentProvider, document, loading = false, enlargeable = true, onCurrent, onError, createBridge = createComposerPreviewBridge, location: suppliedLocation, hostWindow }: MappingPreviewHostProps): JSX.Element {
  return <CompositionPreviewHost
    componentProvider={componentProvider}
    document={document}
    loading={loading}
    title="Resolved Mapping preview"
    emptyMessage="Choose a valid Composition and sample Entry to render a resolved preview."
    enlargeable={enlargeable}
    onCurrent={onCurrent}
    onError={onError}
    createBridge={createBridge}
    location={suppliedLocation}
    hostWindow={hostWindow}
  />;
}
