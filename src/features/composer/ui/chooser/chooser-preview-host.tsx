"use client";
// The chooser's live preview pane (issue Takazudo/zudo-sg#254).
//
// Mounts a SECOND, dedicated preview iframe with its OWN instance-scoped Takazudo/zudo-sg#248
// bridge — created when this component mounts (the dialog's content is gated
// on `capturedTarget`, so that is effectively "dialog open") and disposed when
// it unmounts (dialog close). This is a PEER of Takazudo/zudo-sg#251's `ComposerCanvasHost`,
// not a variant of it: it never touches the main canvas iframe or its
// revision stream (separate bridge instance, separate `hostWindow` listener),
// sends single-node documents built from a manifest entry's defaults, and
// makes no persistence writes. The chooser owns this pane's entire lifecycle
// end-to-end — no wiring through the app-level integration hook.
//
// ── Preview document shape ───────────────────────────────────────────────────
// One node at the document root: the previewed entry's own `componentId` +
// `defaults`. For a container (one or more declared slots) every slot gets a
// single `PlaceholderBox` child (the fixture pack's designated preview child,
// looked up in the SAME catalog the chooser already has — no second provider
// read) so the layout reads; a leaf (no declared slots) renders bare.
//
// ── Non-interactive ──────────────────────────────────────────────────────────
// The session's `mode` is always `"preview"`, so the iframe renders no Edit-
// mode chrome or insert points, and `pointer-events: none` on the stage
// (`sg-composer-chooser-preview-stage`, styles.css) keeps the frame itself
// out of the tab/click order — this pane is look-only.

import { computed, getScope, Show, signal, type Child, type Ref } from "@takazudo/zfb/zudo-react";
import type { VersionedAssetStore } from "../../../../assets/library";
import { toSignal, type MaybeSignal } from "../../../../components/reactive";
import { liveSlot, type LiveChild } from "../../../../components/rebuild";
import { assetResolvedPreviewSnapshot } from "../../preview/assets-snapshot";
import type { CompositionDocument, CompositionNode } from "../../../../composer/browser";
import { COMPOSITION_SCHEMA_VERSION } from "../../../../composer/browser";
import type { ComponentDefinition, ComposerComponentProvider } from "../../active-pack";
import {
  buildComposerPreviewUrl,
  composerPreviewFrameProps,
  createComposerPreviewBridge,
  localPreviewSnapshot,
  type ComposerPreviewBridge,
  type ComposerPreviewLocation,
  type MessageTarget,
  type PreviewSession,
} from "../../preview";
import { resolvedThemeSignal } from "../../../../theme/use-resolved-theme";

/** Stable id of the fixture pack's designated preview child (see module header). */
export const CHOOSER_PREVIEW_PLACEHOLDER_ID = "ui.placeholder-box";

const PREVIEW_IFRAME_TITLE = "Composer chooser live preview";

/**
 * Builds the single-node preview document for `entry`: its own `defaults` as
 * props, and — for every declared slot — one `PlaceholderBox` child so a
 * container's layout reads (an entry with no declared slots is a leaf and
 * renders bare). Exported for direct unit testing; also used by
 * `ChooserPreviewHost` itself.
 */
export function buildChooserPreviewDocument(
  entry: ComponentDefinition,
  catalogById: ReadonlyMap<string, ComponentDefinition>,
): CompositionDocument {
  const placeholder = catalogById.get(CHOOSER_PREVIEW_PLACEHOLDER_ID);
  const slots: Record<string, CompositionNode[]> = {};
  for (const slot of entry.slots) {
    slots[slot.id] = placeholder
      ? [
          {
            id: `chooser-preview-slot-${slot.id}`,
            componentId: placeholder.id,
            componentVersion: placeholder.schemaVersion,
            props: { ...placeholder.defaults },
            slots: {},
          },
        ]
      : [];
  }
  return {
    schemaVersion: COMPOSITION_SCHEMA_VERSION,
    id: "chooser-preview",
    name: "Chooser preview",
    root: [
      {
        id: "chooser-preview-root",
        componentId: entry.id,
        componentVersion: entry.schemaVersion,
        props: { ...entry.defaults },
        slots,
      },
    ],
  };
}

export interface ChooserPreviewHostProps {
  componentProvider: ComposerComponentProvider;
  /** The catalog entry currently previewed. Null before the first hover/focus. */
  entry: MaybeSignal<ComponentDefinition | null>;
  /** A fully loaded Pattern source document, rendered intact rather than as a single component preview. */
  sourceDocument?: MaybeSignal<CompositionDocument | null | undefined>;
  /** Keeps the shared isolated-preview shell correctly labelled in each chooser tab. */
  label?: string;
  /** Chooser-owned context shown between the description and the stage. */
  notice?: LiveChild;
  /** Full catalog lookup, for resolving the PlaceholderBox preview child. */
  catalogById: ReadonlyMap<string, ComponentDefinition>;
  /** The workspace's versioned Asset store, for resolving managed Asset references. */
  assetStore?: VersionedAssetStore;

  // ── Test seams (production defaults) — mirror ComposerCanvasHost's ────────
  createBridge?: typeof createComposerPreviewBridge;
  location?: ComposerPreviewLocation;
  hostWindow?: MessageTarget;
}

/**
 * The bridge and iframe live as long as the pane: entry and Pattern changes
 * arrive through signals and are sent over the same bridge.
 */
export function ChooserPreviewHost(props: ChooserPreviewHostProps): Child {
  const {
    componentProvider,
    label = "Live preview",
    notice,
    catalogById,
    assetStore,
    createBridge = createComposerPreviewBridge,
    location: locationProp,
    hostWindow,
  } = props;
  const scope = getScope();
  const entry = toSignal(props.entry);
  const sourceDocument = toSignal(props.sourceDocument ?? null);

  const frameRef: Ref<HTMLIFrameElement> = { current: null };
  let bridge: ComposerPreviewBridge | null = null;
  let renderedDocument: CompositionDocument | null = null;
  let renderedTheme: "light" | "dark" | null = null;
  const fatalError = signal<string | null>(null);
  const activeTheme = resolvedThemeSignal(scope);

  const location = locationProp ?? buildComposerPreviewUrl();
  const frameProps = composerPreviewFrameProps(location, PREVIEW_IFRAME_TITLE);
  let lastInputs: readonly [ComponentDefinition | null, CompositionDocument | null | undefined] | null = null;
  let lastSnapshot: ReturnType<typeof localPreviewSnapshot> | null = null;
  const authoredSnapshot = computed(() => {
    const inputs = [entry.value, sourceDocument.value] as const;
    if (lastInputs && lastInputs[0] === inputs[0] && lastInputs[1] === inputs[1]) return lastSnapshot;
    lastInputs = inputs;
    const document = inputs[1] ?? (inputs[0] ? buildChooserPreviewDocument(inputs[0], catalogById) : null);
    lastSnapshot = document ? localPreviewSnapshot(document, document.id) : null;
    return lastSnapshot;
  });
  const asset = assetResolvedPreviewSnapshot(scope, authoredSnapshot, componentProvider.catalog, { store: assetStore });
  const previewDocument = computed(() => asset.value.snapshot?.document ?? null);

  // Created on mount, disposed on unmount — this pane's whole lifetime is the
  // dialog being open, which is exactly the "ephemeral" contract (Takazudo/zudo-sg#254): no
  // singleton, no persistence, isolated readiness/revision state per pane.
  scope.onActivate(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    const created = createBridge({
      frame,
      location,
      hostWindow: hostWindow ?? window,
      pack: {
        packId: componentProvider.manifest.packId,
        packVersion: componentProvider.manifest.packVersion,
      },
      onRejected: (reason, detail) => {
        if (reason === "pack-mismatch") {
          fatalError.value = `Preview cannot start: ${detail ?? "The host and preview loaded different packs."}`;
        }
      },
    });
    bridge = created;
    renderedDocument = null;
    // A Pattern host can mount only after an asynchronous source load. Render
    // the latest document here as well as in the update effect so the initial
    // snapshot cannot be lost to effect ordering during that transition.
    const initialDocument = previewDocument.value;
    if (initialDocument) {
      const theme = activeTheme.value;
      created.render(localPreviewSnapshot(initialDocument, initialDocument.id), {
        mode: "preview",
        theme,
        selectedId: null,
      });
      renderedDocument = initialDocument;
      renderedTheme = theme;
    }
    return () => {
      created.dispose();
      bridge = null;
      renderedDocument = null;
      renderedTheme = null;
    };
  });

  scope.effect(() => {
    const document = previewDocument.value;
    const theme = activeTheme.value;
    if (!bridge || !document) return;
    const session: PreviewSession = { mode: "preview", theme, selectedId: null };
    if (renderedDocument !== document) {
      bridge.render(localPreviewSnapshot(document, document.id), session);
      renderedDocument = document;
      renderedTheme = theme;
    } else if (renderedTheme !== theme) {
      bridge.updateSession(session);
      renderedTheme = theme;
    }
  });

  const titled = computed(() => entry.value !== null || !!sourceDocument.value);
  const hasEntry = computed(() => entry.value !== null);
  const hasFatal = computed(() => fatalError.value !== null);
  const empty = computed(() => previewDocument.value === null);
  const assetError = computed(() => asset.value.error ?? null);
  const hasAssetError = computed(() => assetError.value !== null);

  return (
    <div class="sg-composer-chooser-preview">
      <p class="sg-composer-chooser-preview-label">{label}</p>
      <Show when={titled}>{() => (
        <h3 class="sg-composer-chooser-preview-title">{computed(() => entry.value?.title ?? sourceDocument.value?.name ?? "")}</h3>
      )}</Show>
      <Show when={hasEntry}>{() => <p class="sg-composer-chooser-preview-description">{computed(() => entry.value?.description ?? "")}</p>}</Show>
      {liveSlot(notice)}
      <div class="sg-composer-chooser-preview-stage">
        <Show when={hasFatal}>{() => (
          <p class="sg-composer-chooser-pattern-error" role="alert" data-composer-preview-fatal="pack-mismatch">
            {computed(() => fatalError.value ?? "")}
          </p>
        )}</Show>
        <Show when={empty}>{() => (
          <p class="sg-composer-chooser-preview-empty">Hover or focus a component to preview it here.</p>
        )}</Show>
        <Show when={hasAssetError}>{() => <p role="alert">{computed(() => assetError.value ?? "")}</p>}</Show>
        <iframe ref={frameRef} hidden={empty} style={computed(() => (empty.value ? "display: none;" : null))} class="sg-composer-preview-iframe" {...frameProps} />
      </div>
    </div>
  );
}
