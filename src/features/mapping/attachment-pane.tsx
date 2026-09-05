/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { ComposerIcon, EyeIcon, LinkIcon, SlotIcon, TrashIcon } from "../../components/icons";
import { ConfirmDialog, Dialog } from "../../components/overlay";
import { useLibraryConfirm } from "../../components/library-page";
import { Banner, Button, Chip, EmptyState, Field, PaneSection, Select } from "../../components/ui";
import type { MappingRecord } from "../../mapping";
import type { ComposerComponentProvider } from "../composer/component-provider";
import type { MappingEditorController, MappingEditorState } from "./controller";
import { MappingPreviewHost } from "./preview-host";
import { attachmentTargetKey } from "./attachments";

export interface MappingAttachmentPaneProps {
  state: MappingEditorState;
  mapping: MappingRecord;
  controller: MappingEditorController;
  componentProvider: ComposerComponentProvider;
  run: (action: () => void | Promise<void>) => void;
}

export function MappingAttachmentPane({ state, mapping, controller, componentProvider, run }: MappingAttachmentPaneProps): JSX.Element | null {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [fallbackId, setFallbackId] = useState<string | null>(null);
  const confirm = useLibraryConfirm();
  if (mapping.document.mode.kind !== "collection") return null;

  const attachments = state.attachments.snapshot?.attachments.filter((item) => item.mapping.providerId === controller.provider.descriptor.id && item.mapping.recordId === mapping.id) ?? [];
  const occupied = new Set(attachments.map((item) => attachmentTargetKey(item.target)));
  const targets = state.attachments.snapshot?.targets.filter((target) => !occupied.has(attachmentTargetKey(target))) ?? [];
  const previewItem = state.attachments.snapshot?.attachments.find((item) => item.attachment.id === fallbackId);
  const previewDocument = fallbackId && previewItem?.staticFallback ? previewItem.staticFallback : state.attachments.preview?.document ?? attachments[0]?.materializedDocument ?? null;

  return (
    <PaneSection title="Composition attachment" class="cms-mapping-attachment" action={<Button size="sm" variant="ghost" disabled={!controller.hasAttachmentService || targets.length === 0} onClick={() => setDialogOpen(true)}><LinkIcon size="sm" />Attach</Button>}>
      {state.attachments.phase === "unavailable" ? <EmptyState inline icon={LinkIcon} title="Attachment service unavailable" description="The aggregate workspace service has not supplied named-slot callbacks yet." /> : null}
      {state.attachments.phase === "error" ? <Banner tone="err" title="Attachments unavailable.">{state.attachments.message}</Banner> : null}
      {state.attachments.phase === "loading" ? <p class="cms-mapping-attachment__status" role="status">Loading project attachments…</p> : null}
      {state.attachments.phase === "ready" && attachments.length === 0 ? <EmptyState inline icon={SlotIcon} title="Not attached" description="Mount this collection into one verified Composition named slot to include repeated output in delivery." /> : null}
      {attachments.length ? <div class="cms-mapping-attachment__list">{attachments.map((item) => <article class="cms-mapping-attachment__item" key={item.attachment.id}>
        <header><div><strong>{item.target.compositionName}</strong><span>{item.target.slotLabel} · {item.target.nodeId}.{item.target.slotId}</span></div><Chip tone={item.diagnostics.some((diagnostic) => diagnostic.severity === "blocking") ? "err" : "ok"}>{item.effectiveEntries.length} records</Chip></header>
        <p class="cms-mapping-attachment__mapping"><ComposerIcon size="xs" /> {item.mappingName}</p>
        {item.diagnostics.length ? <div class="cms-mapping-attachment__diagnostics">{item.diagnostics.map((diagnostic) => <Banner key={`${diagnostic.code}:${diagnostic.path ?? ""}`} tone={diagnostic.severity === "blocking" ? "err" : "warn"} title={diagnostic.code}>{diagnostic.message}</Banner>)}</div> : <p class="cms-mapping-attachment__ready">Effective ordered records are materialized by the aggregate compiler.</p>}
        <div class="cms-mapping-attachment__actions"><Button size="sm" variant="ghost" disabled={item.diagnostics.some((diagnostic) => diagnostic.severity === "blocking")} onClick={() => { setFallbackId(null); run(() => controller.previewCollectionAttachment(item.attachment.id)); }}><EyeIcon size="sm" />Preview materialized</Button><Button size="sm" variant="ghost" disabled={!item.staticFallback} onClick={() => setFallbackId(item.attachment.id)}>Inspect static fallback</Button><Button size="sm" variant="ghost" onClick={() => confirm.request({ title: `Detach ${item.target.slotLabel}?`, message: "The owner Composition and collection Mapping remain unchanged. This only removes the aggregate attachment.", confirmLabel: "Detach", tone: "danger", onConfirm: () => run(() => controller.detachCollection(item.attachment.id)) })}><TrashIcon size="sm" />Detach</Button></div>
      </article>)}</div> : null}
      {previewDocument ? <section class="cms-mapping-attachment__preview"><h4>{fallbackId ? "Static fallback" : "Materialized attachment preview"}</h4><MappingPreviewHost componentProvider={componentProvider} document={previewDocument} loading={state.attachments.preview?.status === "ready" && !fallbackId} /></section> : null}
      <AttachCollectionDialog open={dialogOpen} targets={targets} onClose={() => setDialogOpen(false)} onSubmit={(target) => run(async () => { await controller.attachCollection({ composition: target.composition, target: { nodeId: target.nodeId, slotId: target.slotId }, mapping: { providerId: controller.provider.descriptor.id, recordId: mapping.id } }); setDialogOpen(false); })} />
      <ConfirmDialog {...confirm.dialogProps} />
    </PaneSection>
  );
}

function AttachCollectionDialog({ open, targets, onClose, onSubmit }: { open: boolean; targets: NonNullable<MappingEditorState["attachments"]["snapshot"]>["targets"]; onClose: () => void; onSubmit: (target: (typeof targets)[number]) => void }): JSX.Element {
  const [selected, setSelected] = useState("");
  const target = targets.find((candidate) => attachmentTargetKey(candidate) === selected) ?? targets[0];
  return <Dialog open={open} title="Attach collection to a named slot" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!target} onClick={() => target && onSubmit(target)}>Attach collection</Button></>}>
    <p class="cms-dialog__message">The aggregate service validates provider identity, slot compatibility, cardinality, conflicts and cycles before persisting this attachment.</p>
    {targets.length === 0 ? <EmptyState inline icon={SlotIcon} title="No compatible named slots are available." /> : <Field label="Composition named slot" help="Choose the verified owner target; the source Composition is never mutated."><Select aria-label="Composition named slot" value={target ? attachmentTargetKey(target) : ""} onChange={(event) => setSelected(event.currentTarget.value)}>{targets.map((candidate) => <option key={attachmentTargetKey(candidate)} value={attachmentTargetKey(candidate)}>{candidate.compositionName} · {candidate.slotLabel} · {candidate.nodeId}</option>)}</Select></Field>}
  </Dialog>;
}
