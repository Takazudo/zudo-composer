import { computed, getScope, Show, signal, type Child, type ReadonlySignal, type Ref } from "@takazudo/zfb/zudo-react";
import type { VersionedAssetStore } from "../../../assets/library";
import type { CompositionRecordRef, CompositionSummary } from "../../../composer/browser";
import { ExpandIcon } from "../../../components/icons";
import { Dialog } from "../../../components/overlay";
import { read, toSignal, type MaybeSignal } from "../../../components/reactive";
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

/** Whether `ref`'s element is near the viewport, owned by the caller's scope. */
function nearVisible(fallbackNear: ReadonlySignal<boolean>): { ref: Ref<HTMLDivElement>; near: ReadonlySignal<boolean> } {
  const scope = getScope();
  const ref: Ref<HTMLDivElement> = { current: null };
  const observed = signal(false);
  const observerAvailable = typeof IntersectionObserver !== "undefined";
  scope.onActivate(() => {
    const node = ref.current;
    if (!node || !observerAvailable) return undefined;
    const observer = new IntersectionObserver((entries) => {
      observed.value = entries.some((entry) => entry.isIntersecting);
    }, { rootMargin: "320px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  });
  return { ref, near: observerAvailable ? observed : fallbackNear };
}

function FixedViewportPreview({
  componentProvider,
  outcome,
  device,
  title,
  loading,
  onCurrent,
  onError,
  assetStore,
  expanded = false,
}: {
  componentProvider: ComposerComponentProvider;
  outcome: ReadonlySignal<CompositionLibraryPreviewOutcome | null>;
  device: ReadonlySignal<CompositionThumbnailDevice>;
  title: string;
  loading: ReadonlySignal<boolean>;
  onCurrent: () => void;
  onError: (message: string) => void;
  assetStore?: VersionedAssetStore;
  expanded?: boolean;
}): Child {
  const scope = getScope();
  const frame: Ref<HTMLDivElement> = { current: null };
  const scale = signal(1);
  const viewport = computed(() => VIEWPORTS[device.value]);
  scope.effect(() => {
    const width = viewport.value.width;
    const element = frame.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const update = () => { scale.value = Math.min(1, element.clientWidth / width); };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  });
  return (
    <div
      ref={frame}
      class={computed(() => `cms-composition-viewport cms-composition-viewport--${device.value}${expanded ? " cms-composition-viewport--expanded" : ""}`)}
      style={computed(() => ({
        "--composition-viewport-width": `${viewport.value.width}px`,
        "--composition-viewport-height": `${viewport.value.height}px`,
        "--composition-viewport-scale": String(scale.value),
        height: `${viewport.value.height * scale.value}px`,
      }))}
    >
      <div class="cms-composition-viewport__logical">
        <CompositionPreviewHost
          componentProvider={componentProvider}
          document={null}
          snapshot={computed(() => {
            const current = outcome.value;
            return current?.status === "ready" ? current.snapshot : null;
          })}
          title={title}
          loading={loading}
          enlargeable={false}
          emptyTitle={computed(() => (loading.value ? "Loading preview" : "Preview unavailable"))}
          emptyMessage={computed(() => {
            const current = outcome.value;
            return current && current.status !== "ready" ? current.message : "The provider preview is loading.";
          })}
          onCurrent={onCurrent}
          onError={onError}
          assetStore={assetStore}
        />
      </div>
    </div>
  );
}

export interface CompositionLibraryPreviewProps {
  /** Static: the library keys each card by provider, id and `updatedAt`. */
  row: CompositionSummary;
  providerId: CompositionRecordRef["providerId"];
  componentProvider: ComposerComponentProvider;
  intents: CompositionLibraryIntents;
  device: MaybeSignal<CompositionThumbnailDevice>;
  fallbackNear: MaybeSignal<boolean>;
  dialogOpen: MaybeSignal<boolean>;
  onDialogOpenChange: (open: boolean) => void;
  assetStore?: VersionedAssetStore;
}

export function CompositionLibraryPreview({
  row,
  providerId,
  componentProvider,
  intents,
  device: deviceProp,
  fallbackNear,
  dialogOpen: dialogOpenProp,
  onDialogOpenChange,
  assetStore,
}: CompositionLibraryPreviewProps): Child {
  const scope = getScope();
  const device = toSignal(deviceProp);
  const dialogOpen = toSignal(dialogOpenProp);
  const visibility = nearVisible(toSignal(fallbackNear));
  const outcome = signal<CompositionLibraryPreviewOutcome | null>(null);
  const loading = signal(false);
  const rendered = signal(false);
  const runtimeError = signal<string | null>(null);
  const dialogDevice = signal<CompositionThumbnailDevice>(read(deviceProp));
  let generation = 0;
  const shouldLoad = computed(() => visibility.near.value || dialogOpen.value);
  const cardMounted = computed(() => visibility.near.value && !dialogOpen.value);
  const ref: CompositionRecordRef = { providerId, recordId: row.id };

  let loadingFor = false;
  scope.onCleanup(() => { generation += 1; });
  scope.effect(() => {
    const next = shouldLoad.value;
    if (next === loadingFor) return;
    loadingFor = next;
    if (!next) { generation += 1; return; }
    const request = ++generation;
    loading.value = true;
    rendered.value = false;
    runtimeError.value = null;
    outcome.value = null;
    void intents.resolvePreview(ref).then(
      (result) => {
        if (request !== generation || scope.abortSignal.aborted) return;
        if (result.ref.providerId !== ref.providerId || result.ref.recordId !== ref.recordId) {
          outcome.value = { status: "blocked", ref, message: "The provider returned a preview for a different Composition." };
        } else {
          outcome.value = result;
        }
        loading.value = false;
      },
      (reason) => {
        if (request !== generation || scope.abortSignal.aborted) return;
        outcome.value = {
          status: "blocked",
          ref,
          message: reason instanceof Error ? reason.message : "The preview could not be loaded.",
        };
        loading.value = false;
      },
    );
  });

  const onCurrent = () => { rendered.value = true; };
  const onError = (error: string) => { runtimeError.value = error; rendered.value = false; };
  const blocked = computed(() => {
    const current = outcome.value;
    return current && current.status !== "ready" ? current.message : null;
  });
  const hasBlocked = computed(() => blocked.value !== null);
  const hasRuntimeError = computed(() => runtimeError.value !== null);
  const runtimeMessage = computed(() => runtimeError.value ?? "");

  return (
    <div ref={visibility.ref} class="cms-composition-card__preview">
      <Show
        when={cardMounted}
        fallback={() => <div class="cms-composition-card__deferred">{computed(() => (dialogOpen.value ? "Preview shown in dialog" : "Preview loads when nearby"))}</div>}
      >
        {() => (
          <FixedViewportPreview
            componentProvider={componentProvider}
            outcome={outcome}
            device={device}
            title={`${row.name} preview`}
            loading={computed(() => loading.value || (outcome.value?.status === "ready" && !rendered.value))}
            onCurrent={onCurrent}
            onError={onError}
            assetStore={assetStore}
          />
        )}
      </Show>
      <Show when={hasRuntimeError}>{() => <div role="alert" class="cms-composition-card__preview-error">{runtimeMessage}</div>}</Show>
      <Button size="xs" class="cms-composition-card__preview-button" on:click={() => { dialogDevice.value = device.value; onDialogOpenChange(true); }}>
        <ExpandIcon size="xs" /> Preview
      </Button>
      <div class="cms-composition-card__caption">
        <span>{computed(() => {
          const viewport = VIEWPORTS[device.value];
          return `${viewport.label} · ${viewport.width} × ${viewport.height}`;
        })}</span>
        <span>{computed(() => runtimeError.value ? "Preview error" : outcome.value?.status === "ready" && rendered.value ? "Rendered preview" : loading.value ? "Loading…" : "Provider preview")}</span>
      </div>
      <Dialog
        open={dialogOpen}
        size="wide"
        class="cms-composition-preview-dialog"
        title={`Preview — ${row.name}`}
        onClose={() => onDialogOpenChange(false)}
        footer={<button type="button" class="cms-dialog__action" on:click={() => onDialogOpenChange(false)}>Close</button>}
      >
        <SegmentedControl<CompositionThumbnailDevice>
          label="Preview device"
          size="sm"
          value={dialogDevice}
          onChange={(next) => { dialogDevice.value = next; }}
          options={[{ value: "desktop", label: "Desktop" }, { value: "phone", label: "Phone" }]}
        />
        <Show when={hasBlocked}>{() => <Banner tone="err">{computed(() => blocked.value ?? "")}</Banner>}</Show>
        <Show when={hasRuntimeError}>{() => <Banner tone="err">{runtimeMessage}</Banner>}</Show>
        <FixedViewportPreview
          componentProvider={componentProvider}
          outcome={outcome}
          device={dialogDevice}
          title={`${row.name} large preview`}
          loading={loading}
          expanded
          onCurrent={onCurrent}
          onError={onError}
          assetStore={assetStore}
        />
      </Dialog>
    </div>
  );
}
