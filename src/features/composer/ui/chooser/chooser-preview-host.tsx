"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The chooser's live preview pane (issue #254).
//
// Mounts a SECOND, dedicated preview iframe with its OWN instance-scoped #248
// bridge — created when this component mounts (the dialog's content is gated
// on `capturedTarget`, so that is effectively "dialog open") and disposed when
// it unmounts (dialog close). This is a PEER of #251's `ComposerCanvasHost`,
// not a variant of it: it never touches the main canvas iframe or its
// revision stream (separate bridge instance, separate `hostWindow` listener),
// sends single-node documents built from a manifest entry's defaults, and
// makes no persistence writes. The chooser owns this pane's entire lifecycle
// end-to-end — no wiring through the app-level integration hook.
//
// ── Preview document shape ───────────────────────────────────────────────────
// One node at the document root: the previewed entry's own `componentId` +
// `defaults`. For a container (one or more declared slots) every slot gets a
// single `PlaceholderBox` child (the #246 cohort's designated sample child,
// looked up in the SAME catalog the chooser already has — no second registry
// read) so the layout reads; a leaf (no declared slots) renders bare.
//
// ── Non-interactive ──────────────────────────────────────────────────────────
// The session's `mode` is always `"preview"`, so the iframe renders no Edit-
// mode chrome or insert points, and `pointer-events: none` on the stage
// (`sg-composer-chooser-preview-stage`, styles.css) keeps the frame itself
// out of the tab/click order — this pane is look-only.

import { useEffect, useMemo, useRef } from "preact/hooks";
import type { JSX } from "preact";
import type { CompositionDocument, CompositionNode } from "../../../../composer";
import { COMPOSITION_SCHEMA_VERSION } from "../../../../composer";
import type { ComponentDefinition } from "../../active-pack";
import {
  buildComposerPreviewUrl,
  composerPreviewFrameProps,
  createComposerPreviewBridge,
  type ComposerPreviewBridge,
  type ComposerPreviewLocation,
  type MessageTarget,
  type PreviewSession,
} from "../../preview";

/** Stable id of the #246 cohort's designated sample child (see module header). */
export const CHOOSER_PREVIEW_PLACEHOLDER_ID = "ui.placeholder-box";

const PREVIEW_IFRAME_TITLE = "Composer chooser live preview";

/** Resolve the host document's light/dark scheme. Deliberately self-contained
 *  (no cross-feature import) — mirrors `app/use-host-theme.ts`'s DOM read,
 *  which lives outside this issue's owned directory. */
function resolveChooserPreviewTheme(): "light" | "dark" {
  return globalThis.document?.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

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
  /** The catalog entry currently previewed. Null before the first hover/focus. */
  entry: ComponentDefinition | null;
  /** A fully loaded Pattern source document, rendered intact rather than as a single component sample. */
  sourceDocument?: CompositionDocument | null;
  /** Keeps the shared isolated-preview shell correctly labelled in each chooser tab. */
  label?: string;
  /** Full catalog lookup, for resolving the PlaceholderBox sample child. */
  catalogById: ReadonlyMap<string, ComponentDefinition>;

  // ── Test seams (production defaults) — mirror ComposerCanvasHost's ────────
  createBridge?: typeof createComposerPreviewBridge;
  location?: ComposerPreviewLocation;
  hostWindow?: MessageTarget;
}

export function ChooserPreviewHost(props: ChooserPreviewHostProps): JSX.Element {
  const {
    entry,
    sourceDocument,
    label = "Live preview",
    catalogById,
    createBridge = createComposerPreviewBridge,
    location: locationProp,
    hostWindow,
  } = props;

  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const bridgeRef = useRef<ComposerPreviewBridge | null>(null);
  const renderedDocumentRef = useRef<CompositionDocument | null>(null);

  const location = useMemo(() => locationProp ?? buildComposerPreviewUrl(), [locationProp]);
  const frameProps = useMemo(
    () => composerPreviewFrameProps(location, PREVIEW_IFRAME_TITLE),
    [location],
  );
  const previewDocument = useMemo(
    () => sourceDocument ?? (entry ? buildChooserPreviewDocument(entry, catalogById) : null),
    [catalogById, entry, sourceDocument],
  );
  const latestPreviewDocumentRef = useRef(previewDocument);
  latestPreviewDocumentRef.current = previewDocument;

  // Created on mount, disposed on unmount — this pane's whole lifetime is the
  // dialog being open, which is exactly the "ephemeral" contract (#254): no
  // singleton, no persistence, isolated readiness/revision state per pane.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const bridge = createBridge({ frame, location, hostWindow: hostWindow ?? window });
    bridgeRef.current = bridge;
    renderedDocumentRef.current = null;
    // A Pattern host can mount only after an asynchronous source load. Render
    // the latest document here as well as in the update effect so the initial
    // snapshot cannot be lost to effect ordering during that transition.
    const initialDocument = latestPreviewDocumentRef.current;
    if (initialDocument) {
      bridge.render(initialDocument, {
        mode: "preview",
        theme: resolveChooserPreviewTheme(),
        selectedId: null,
      });
      renderedDocumentRef.current = initialDocument;
    }
    return () => {
      bridge.dispose();
      bridgeRef.current = null;
      renderedDocumentRef.current = null;
    };
  }, [createBridge, location, hostWindow]);

  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !previewDocument || renderedDocumentRef.current === previewDocument) return;
    const session: PreviewSession = {
      mode: "preview",
      theme: resolveChooserPreviewTheme(),
      selectedId: null,
    };
    bridge.render(previewDocument, session);
    renderedDocumentRef.current = previewDocument;
  }, [previewDocument]);

  return (
    <div class="sg-composer-chooser-preview">
      <p class="sg-composer-chooser-preview-label">{label}</p>
      <div class="sg-composer-chooser-preview-stage">
        {!previewDocument && (
          <p class="sg-composer-chooser-preview-empty">Hover or focus a component to preview it here.</p>
        )}
        <iframe ref={frameRef} class="sg-composer-preview-iframe" {...frameProps} />
      </div>
    </div>
  );
}
