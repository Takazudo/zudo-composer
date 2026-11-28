import { computed, Show, signal, type Child, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { ComposerIcon, EyeIcon, LinkIcon, SlotIcon, TrashIcon } from "../../components/icons";
import { ConfirmDialog, Dialog } from "../../components/overlay";
import { createLibraryConfirm } from "../../components/library-page";
import { Rebuild } from "../../components/rebuild";
import { Keyed } from "../../runtime";
import { Banner, Button, Chip, EmptyState, Field, PaneSection, Select } from "../../components/ui";
import type { ComposerComponentProvider } from "../composer/component-provider";
import type { MappingEditorController, MappingEditorState } from "./controller";
import { MappingPreviewHost } from "./preview-host";
import { attachmentTargetKey } from "./attachments";
import { memo } from "../../components/reactive";

type AttachmentTargets = NonNullable<MappingEditorState["attachments"]["snapshot"]>["targets"];

export interface MappingAttachmentPaneProps {
  state: ReadonlySignal<MappingEditorState>;
  controller: MappingEditorController;
  componentProvider: ComposerComponentProvider;
  run: (action: () => void | Promise<void>) => void;
}

export function MappingAttachmentPane({ state, controller, componentProvider, run }: MappingAttachmentPaneProps): Child {
  return (
    <Show when={computed(() => state.value.mapping?.document.mode.kind === "collection")}>{() => (
      <CollectionAttachmentPane state={state} controller={controller} componentProvider={componentProvider} run={run} />
    )}</Show>
  );
}

function CollectionAttachmentPane({ state, controller, componentProvider, run }: MappingAttachmentPaneProps): Child {
  const dialogOpen = signal(false);
  const fallbackSelection = signal<{ attachmentId: string; targetKey: string } | null>(null);
  const confirm = createLibraryConfirm();
  const mappingId = computed(() => state.value.mapping?.id ?? "");
  const snapshot = computed(() => state.value.attachments.snapshot);
  const attachments = memo(() => snapshot.value?.attachments.filter((item) => item.mapping.providerId === controller.provider.descriptor.id && item.mapping.recordId === mappingId.value) ?? []);
  const targets = memo(() => {
    const occupied = new Set(attachments.value.map((item) => attachmentTargetKey(item.target)));
    return snapshot.value?.targets.filter((target) => !occupied.has(attachmentTargetKey(target))) ?? [];
  });
  const previewItem = computed(() => {
    const selection = fallbackSelection.value;
    return selection ? snapshot.value?.attachments.find((item) => item.attachment.id === selection.attachmentId && attachmentTargetKey(item.target) === selection.targetKey) : undefined;
  });
  const fallbackActive = computed(() => Boolean(previewItem.value?.staticFallback));
  const previewDocument = computed(() => fallbackActive.value ? previewItem.value!.staticFallback! : state.value.attachments.preview?.document ?? attachments.value[0]?.materializedDocument ?? null);
  const phase = computed(() => state.value.attachments.phase);

  return (
    <PaneSection title="Composition attachment" class="cms-mapping-attachment" action={<Button size="sm" variant="ghost" disabled={computed(() => !controller.hasAttachmentService || targets.value.length === 0)} on:click={() => { dialogOpen.value = true; }}><LinkIcon size="sm" />Attach</Button>}>
      <Show when={computed(() => phase.value === "unavailable")}>{() => <EmptyState inline icon={LinkIcon} title="Attachment service unavailable" description="The aggregate workspace service has not supplied named-slot callbacks yet." />}</Show>
      <Show when={computed(() => phase.value === "error")}>{() => <Banner tone="err" title="Attachments unavailable.">{computed(() => state.value.attachments.message ?? "")}</Banner>}</Show>
      <Show when={computed(() => phase.value === "loading")}>{() => <p class="cms-mapping-attachment__status" role="status">Loading project attachments…</p>}</Show>
      <Show when={computed(() => phase.value === "ready" && attachments.value.length === 0)}>{() => <EmptyState inline icon={SlotIcon} title="Not attached" description="Mount this collection into one verified Composition named slot to include repeated output in delivery." />}</Show>
      <Rebuild value={attachments}>{(current) => current.length ? <div class="cms-mapping-attachment__list">{current.map((item) => <article class="cms-mapping-attachment__item" key={item.attachment.id}>
        <header><div><strong>{item.target.compositionName}</strong><span>{item.target.slotLabel} · {item.target.nodeId}.{item.target.slotId}</span></div><Chip tone={item.diagnostics.some((diagnostic) => diagnostic.severity === "blocking") ? "err" : "ok"}>{item.effectiveEntries.length} records</Chip></header>
        <p class="cms-mapping-attachment__mapping"><ComposerIcon size="xs" /> {item.mappingName}</p>
        {item.diagnostics.length ? <div class="cms-mapping-attachment__diagnostics">{item.diagnostics.map((diagnostic) => <Banner key={`${diagnostic.code}:${diagnostic.path ?? ""}`} tone={diagnostic.severity === "blocking" ? "err" : "warn"} title={diagnostic.code}>{diagnostic.message}</Banner>)}</div> : <p class="cms-mapping-attachment__ready">Effective ordered records are materialized by the aggregate compiler.</p>}
        <div class="cms-mapping-attachment__actions"><Button size="sm" variant="ghost" disabled={item.diagnostics.some((diagnostic) => diagnostic.severity === "blocking")} on:click={() => { fallbackSelection.value = null; run(() => controller.previewCollectionAttachment(item.attachment.id)); }}><EyeIcon size="sm" />Preview materialized</Button><Button size="sm" variant="ghost" disabled={!item.staticFallback} on:click={() => { fallbackSelection.value = { attachmentId: item.attachment.id, targetKey: attachmentTargetKey(item.target) }; }}>Inspect static fallback</Button><Button size="sm" variant="ghost" on:click={() => confirm.request({ title: `Detach ${item.target.slotLabel}?`, message: "The owner Composition and collection Mapping remain unchanged. This only removes the aggregate attachment.", confirmLabel: "Detach", tone: "danger", onConfirm: () => run(() => controller.detachCollection(item.attachment.id)) })}><TrashIcon size="sm" />Detach</Button></div>
      </article>)}</div> : null}</Rebuild>
      <Show when={computed(() => previewDocument.value !== null)}>{() => <section class="cms-mapping-attachment__preview"><h4>{computed(() => fallbackActive.value ? "Static fallback" : "Materialized attachment preview")}</h4><MappingPreviewHost componentProvider={componentProvider} document={previewDocument} loading={computed(() => state.value.attachments.preview?.status === "ready" && !fallbackActive.value)} /></section>}</Show>
      <AttachCollectionDialog open={dialogOpen} targets={targets} onClose={() => { dialogOpen.value = false; }} onSubmit={(target) => run(async () => { await controller.attachCollection({ composition: target.composition, target: { nodeId: target.nodeId, slotId: target.slotId }, mapping: { providerId: controller.provider.descriptor.id, recordId: mappingId.value } }); dialogOpen.value = false; })} />
      <ConfirmDialog {...confirm.dialogProps} />
    </PaneSection>
  );
}

function AttachCollectionDialog({ open, targets, onClose, onSubmit }: { open: ReadonlySignal<boolean>; targets: ReadonlySignal<AttachmentTargets>; onClose: () => void; onSubmit: (target: AttachmentTargets[number]) => void }): Child {
  const selected = signal("");
  const target = computed(() => targets.value.find((candidate) => attachmentTargetKey(candidate) === selected.value) ?? targets.value[0]);
  const optionsKey = computed(() => targets.value.map(attachmentTargetKey).join("\u0001"));
  return <Dialog open={open} title="Attach collection to a named slot" onClose={onClose} footer={<><Button variant="ghost" on:click={onClose}>Cancel</Button><Button variant="primary" disabled={computed(() => !target.value)} on:click={() => { const current = target.value; if (current) onSubmit(current); }}>Attach collection</Button></>}>
    <p class="cms-dialog__message">The aggregate service validates provider identity, slot compatibility, cardinality, conflicts and cycles before persisting this attachment.</p>
    <Show when={computed(() => targets.value.length === 0)}>{() => <EmptyState inline icon={SlotIcon} title="No compatible named slots are available." />}</Show>
    <Show when={computed(() => targets.value.length > 0)}>{() => <Field label="Composition named slot" help="Choose the verified owner target; the source Composition is never mutated.">{(field) => (
      <Keyed value={optionsKey} by={(key) => key}>{() => {
        const current = targets.value;
        const model = signal(target.value ? attachmentTargetKey(target.value) : "");
        return <Select field={field} aria-label="Composition named slot" modelValue={model} on:change={(event) => { selected.value = event.currentTarget.value; }}>{current.map((candidate) => <option key={attachmentTargetKey(candidate)} value={attachmentTargetKey(candidate)}>{`${candidate.compositionName} · ${candidate.slotLabel} · ${candidate.nodeId}`}</option>)}</Select>;
      }}</Keyed>
    )}</Field>}</Show>
  </Dialog>;
}
