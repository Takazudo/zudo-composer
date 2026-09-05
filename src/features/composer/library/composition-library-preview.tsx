/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { CompositionRecordRef, CompositionSummary } from "../../../composer/browser";
import { ExpandIcon } from "../../../components/icons";
import { Dialog } from "../../../components/overlay";
import { Banner, Button, SegmentedControl } from "../../../components/ui";
import type { ComposerComponentProvider } from "../active-pack";
import { CompositionPreviewHost } from "../preview";
import type { CompositionLibraryIntents, CompositionLibraryPreviewOutcome } from "./library-contract";

export type CompositionThumbnailDevice = "desktop" | "phone";

const VIEWPORTS = {
  desktop: { width: 960, height: 640, label: "Desktop" },
  phone: { width: 390, height: 844, label: "Phone" },
} as const;

/** Deterministic ceiling when IntersectionObserver is unavailable. */
export const COMPOSITION_PREVIEW_FALLBACK_LIMIT = 4;

function useNearVisible(fallbackNear: boolean): { ref: (node: HTMLDivElement | null) => void; near: boolean } {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [near, setNear] = useState(false);
  const observerAvailable = typeof IntersectionObserver !== "undefined";
  useEffect(() => {
    if (!node) return;
    if (!observerAvailable) return;
    const observer = new IntersectionObserver((entries) => {
      setNear(entries.some((entry) => entry.isIntersecting));
    }, { rootMargin: "320px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, observerAvailable]);
  return { ref: setNode, near: observerAvailable ? near : fallbackNear };
}

function message(outcome: Exclude<CompositionLibraryPreviewOutcome, { status: "ready" }>): string {
  return outcome.message;
}

function FixedViewportPreview({
  componentProvider,
  outcome,
  device,
  title,
  loading,
  onCurrent,
  onError,
  expanded = false,
}: {
  componentProvider: ComposerComponentProvider;
  outcome: CompositionLibraryPreviewOutcome | null;
  device: CompositionThumbnailDevice;
  title: string;
  loading: boolean;
  onCurrent: () => void;
  onError: (message: string) => void;
  expanded?: boolean;
}): JSX.Element {
  const viewport = VIEWPORTS[device];
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (!frame || typeof ResizeObserver === "undefined") return;
    const update = () => setScale(Math.min(1, frame.clientWidth / viewport.width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frame, viewport.width]);
  return (
    <div
      ref={setFrame}
      class={`cms-composition-viewport cms-composition-viewport--${device}${expanded ? " cms-composition-viewport--expanded" : ""}`}
      style={{
        "--composition-viewport-width": `${viewport.width}px`,
        "--composition-viewport-height": `${viewport.height}px`,
        "--composition-viewport-scale": scale,
        height: `${viewport.height * scale}px`,
      }}
    >
      <div class="cms-composition-viewport__logical">
        <CompositionPreviewHost
          componentProvider={componentProvider}
          document={null}
          snapshot={outcome?.status === "ready" ? outcome.snapshot : null}
          title={title}
          loading={loading}
          enlargeable={false}
          emptyTitle={loading ? "Loading preview" : "Preview unavailable"}
          emptyMessage={outcome && outcome.status !== "ready" ? message(outcome) : "The provider preview is loading."}
          onCurrent={onCurrent}
          onError={onError}
        />
      </div>
    </div>
  );
}

export function CompositionLibraryPreview({
  row,
  providerId,
  componentProvider,
  intents,
  device,
  fallbackNear,
  dialogOpen,
  onDialogOpenChange,
}: {
  row: CompositionSummary;
  providerId: CompositionRecordRef["providerId"];
  componentProvider: ComposerComponentProvider;
  intents: CompositionLibraryIntents;
  device: CompositionThumbnailDevice;
  fallbackNear: boolean;
  dialogOpen: boolean;
  onDialogOpenChange: (open: boolean) => void;
}): JSX.Element {
  const visibility = useNearVisible(fallbackNear);
  const [outcome, setOutcome] = useState<CompositionLibraryPreviewOutcome | null>(null);
  const [loading, setLoading] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [dialogDevice, setDialogDevice] = useState<CompositionThumbnailDevice>(device);
  const generation = useRef(0);
  const shouldLoad = visibility.near || dialogOpen;
  const cardMounted = visibility.near && !dialogOpen;
  const ref = useMemo<CompositionRecordRef>(
    () => ({ providerId, recordId: row.id }),
    [providerId, row.id],
  );

  useEffect(() => {
    if (!shouldLoad) return;
    const request = ++generation.current;
    setLoading(true);
    setRendered(false);
    setRuntimeError(null);
    setOutcome(null);
    void intents.resolvePreview(ref).then(
      (next) => {
        if (request !== generation.current) return;
        if (next.ref.providerId !== ref.providerId || next.ref.recordId !== ref.recordId) {
          setOutcome({ status: "blocked", ref, message: "The provider returned a preview for a different Composition." });
        } else {
          setOutcome(next);
        }
        setLoading(false);
      },
      (reason) => {
        if (request !== generation.current) return;
        setOutcome({
          status: "blocked",
          ref,
          message: reason instanceof Error ? reason.message : "The preview could not be loaded.",
        });
        setLoading(false);
      },
    );
    return () => { generation.current += 1; };
  }, [intents, ref, row.updatedAt, shouldLoad]);

  const preview = cardMounted ? (
    <FixedViewportPreview
      componentProvider={componentProvider}
      outcome={outcome}
      device={device}
      title={`${row.name} preview`}
      loading={loading || (outcome?.status === "ready" && !rendered)}
      onCurrent={() => setRendered(true)}
      onError={(error) => { setRuntimeError(error); setRendered(false); }}
    />
  ) : <div class="cms-composition-card__deferred">{dialogOpen ? "Preview shown in dialog" : "Preview loads when nearby"}</div>;

  return (
    <div ref={visibility.ref} class="cms-composition-card__preview">
      {preview}
      {runtimeError ? <div role="alert" class="cms-composition-card__preview-error">{runtimeError}</div> : null}
      <Button size="xs" class="cms-composition-card__preview-button" onClick={() => { setDialogDevice(device); onDialogOpenChange(true); }}>
        <ExpandIcon size="xs" /> Preview
      </Button>
      <div class="cms-composition-card__caption">
        <span>{VIEWPORTS[device].label} · {VIEWPORTS[device].width} × {VIEWPORTS[device].height}</span>
        <span>{runtimeError ? "Preview error" : outcome?.status === "ready" && rendered ? "Rendered preview" : loading ? "Loading…" : "Provider preview"}</span>
      </div>
      <Dialog
        open={dialogOpen}
        size="wide"
        class="cms-composition-preview-dialog"
        title={`Preview — ${row.name}`}
        onClose={() => onDialogOpenChange(false)}
        footer={<button type="button" class="cms-dialog__action" onClick={() => onDialogOpenChange(false)}>Close</button>}
      >
        <SegmentedControl<CompositionThumbnailDevice>
          label="Preview device"
          size="sm"
          value={dialogDevice}
          onChange={setDialogDevice}
          options={[{ value: "desktop", label: "Desktop" }, { value: "phone", label: "Phone" }]}
        />
        {outcome && outcome.status !== "ready" ? <Banner tone="err">{outcome.message}</Banner> : null}
        {runtimeError ? <Banner tone="err">{runtimeError}</Banner> : null}
        <FixedViewportPreview
          componentProvider={componentProvider}
          outcome={outcome}
          device={dialogDevice}
          title={`${row.name} large preview`}
          loading={loading}
          expanded
          onCurrent={() => setRendered(true)}
          onError={(error) => { setRuntimeError(error); setRendered(false); }}
        />
      </Dialog>
    </div>
  );
}
