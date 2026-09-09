import { downloadAsset } from "../../browser/asset-download.mjs";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Dialog } from "../../components/overlay";
import { Banner, Button, Checkbox, Field, Input, Select, SegmentedControl, Textarea } from "../../components/ui";
import { summarizeAsset, ASSET_MAX_BYTE_LENGTH, assetDownloadFileName, assetTypeLabel, assetByteLabel, type AssetProvider, type AssetSummary } from "../../assets";
import type { AssetInsertionTarget, AssetUse } from "../../assets/integration/content";
import type { AssetLibraryController } from "./controller";

const targetKey = (target: AssetInsertionTarget) => JSON.stringify([target.providerId, target.modelId, target.entryId, target.fieldId, target.valuePath]);
export function AssetUsePicker({ record, controller, onClose }: { record: AssetSummary; controller: AssetLibraryController; onClose(): void }) {
  const [targets, setTargets] = useState<readonly AssetInsertionTarget[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<AssetUse["kind"]>(record.mimeType.startsWith("image/") ? "image" : record.mimeType === "application/pdf" ? "link" : "download");
  const [selected, setSelected] = useState("");
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    if (!controller.contentServices) {
      setError("Authoritative Content destinations are unavailable.");
      setLoading(false);
    } else void controller.contentServices.targets().then((value) => { if (live) setTargets(value); }).catch((error) => { if (live) setError(error.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [controller]);
  const eligible = targets.filter((target) => target.kind === kind);
  const target = eligible.find((target) => targetKey(target) === selected) ?? eligible[0];
  return <Dialog open title="Use this asset" onClose={onClose} dismissOnBackdrop={false}>
    {error ? <Banner tone="err">{error}</Banner> : null}
    <AssetUseForm record={record} providerId={controller.provider.descriptor.id} kind={kind} onKindChange={setKind} disabled={loading || !target} onClose={onClose} onSubmit={async (value) => { if (!target) throw new Error("Choose an available Content destination."); await controller.insert(target, value); onClose(); }}>
      {loading ? <p role="status">Loading complete Content destinations…</p> : <Field label="Content destination" help={target?.append ? "Append to this asset list." : "Replace this single asset field."}><Select value={target ? targetKey(target) : ""} onChange={(event) => setSelected(event.currentTarget.value)}><option value="" disabled>Choose model / entry / field</option>{eligible.map((item) => <option key={targetKey(item)} value={targetKey(item)}>{item.modelName} / {item.entryTitle} / {item.fieldLabel}{item.valuePath.length ? ` / ${item.valuePath.join(" / ")}` : ""}</option>)}</Select></Field>}
      {!loading && !eligible.length ? <p>No writable {kind} fields are available. Create a matching asset-use field in Content first.</p> : null}
    </AssetUseForm>
  </Dialog>;
}

/** An explicit field integration: the caller receives a typed value and owns
 * its Content save session. No global selection or prototype state is used. */
export function AssetFieldPicker({ provider, kind, onSelect, onClose }: { provider?: AssetProvider; kind: AssetUse["kind"]; onSelect(value: AssetUse): void | Promise<void>; onClose(): void }) {
  const [records, setRecords] = useState<readonly AssetSummary[]>([]); const [selected, setSelected] = useState(""); const [error, setError] = useState<string | null>(null);
  useEffect(() => { let live = true; if (provider) void provider.store.list().then((value) => { if (live) setRecords(value.filter((record) => record.state === "active" && (kind !== "image" || record.mimeType.startsWith("image/")))); }).catch((error) => { if (live) setError(error.message); }); return () => { live = false; }; }, [provider, kind]);
  const record = records.find(({ id }) => id === selected);
  return <Dialog open title="Choose asset" onClose={onClose} dismissOnBackdrop={false}>
    {!provider ? <Banner tone="info">The Assets library and upload authoring are available only under the local development server (<code>pnpm dev</code>). Committed files under <code>publicAssetsDir</code> are still served from <code>/uploaded-assets/</code>.</Banner> : null}
    {error ? <Banner tone="err">{error}</Banner> : null}
    <Field label="Asset"><Select value={selected} onChange={(event) => setSelected(event.currentTarget.value)}><option value="">Choose an asset</option>{records.map((item) => <option key={item.id} value={item.id}>{item.fileName}</option>)}</Select></Field>
    {record && provider ? <AssetUseForm key={record.id} record={record} providerId={provider.descriptor.id} kind={kind} onClose={onClose} onSubmit={async (value) => {
      const current = await provider.store.get(record.id);
      if (current.status !== "loaded" || current.record.document.state !== "active") throw new Error("This asset is no longer available. Choose another asset.");
      if (kind === "image" && !summarizeAsset(current.record).mimeType.startsWith("image/")) throw new Error("The selected asset is no longer an image.");
      await onSelect(value); onClose();
    }} /> : null}
  </Dialog>;
}

function AssetUseForm({ record, providerId, kind, onKindChange, onSubmit, onClose, disabled = false, children }: {
  record: AssetSummary; providerId: string; kind: AssetUse["kind"]; onKindChange?(kind: AssetUse["kind"]): void;
  onSubmit(value: AssetUse): Promise<void>; onClose(): void; disabled?: boolean; children?: ComponentChildren;
}) {
  const [text, setText] = useState(""); const [label, setLabel] = useState(record.fileName); const [decorative, setDecorative] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [showSize, setShowSize] = useState(true); const [showType, setShowType] = useState(true);
  const asset = { providerId, assetId: record.id };
  const value: AssetUse = kind === "image" ? { kind, asset, alt: decorative ? "" : text, decorative, caption: label }
    : kind === "download" ? { kind, asset, label, showSize, showType } : kind === "link" ? { kind, asset, label } : { kind, asset, title: label, description: text };
  const valid = kind === "image" ? decorative || text.trim().length > 0 : label.trim().length > 0;
  return <fieldset class="sg-assets-use-form" disabled={busy}>
    {onKindChange ? <SegmentedControl label="Asset presentation" value={kind} onChange={onKindChange} options={[{ value: "image", label: "Image", disabled: !record.mimeType.startsWith("image/") }, { value: "link", label: "Link" }, { value: "card", label: "Card" }, { value: "download", label: "Download" }]} /> : null}
    <div class="sg-assets-use-preview">{kind === "image" ? <img src={record.url} alt={decorative ? "" : text} /> : kind === "download" ? <a aria-label={[label, showType ? assetTypeLabel(record.mimeType) : "", showSize ? assetByteLabel(record.byteLength) : ""].filter(Boolean).join(" · ")} href={record.url} download={assetDownloadFileName(record.fileName, record.mimeType)} onClick={(event) => { void downloadAsset(event, ASSET_MAX_BYTE_LENGTH); }}>{label}{showType ? ` · ${assetTypeLabel(record.mimeType)}` : ""}{showSize ? ` · ${assetByteLabel(record.byteLength)}` : ""}</a> : kind === "link" ? <a href={record.url} target="_blank" rel="noreferrer">{label}</a> : <article><strong>{label}</strong><p>{text}</p></article>}</div>
    {(kind === "image" || kind === "card") ? <Field label={kind === "image" ? "Alternative text for this usage" : "Card description"} help="Saved on this Content usage, independently of the asset's internal note."><Textarea value={text} disabled={busy || (kind === "image" && decorative)} onInput={(event) => setText(event.currentTarget.value)} /></Field> : null}
    {kind === "image" ? <label class="sg-assets-actions"><Checkbox aria-label="Decorative image" checked={decorative} disabled={busy} onCheckedChange={setDecorative} /> Decorative image</label> : null}
    <Field label={kind === "image" ? "Caption" : kind === "download" ? "Download label" : kind === "link" ? "Link label" : "Card title"}><Input value={label} disabled={busy} onInput={(event) => setLabel(event.currentTarget.value)} /></Field>
    {kind === "download" ? <><label><Checkbox aria-label="Show file size" checked={showSize} onCheckedChange={setShowSize} /> Show file size</label><label><Checkbox aria-label="Show file type" checked={showType} onCheckedChange={setShowType} /> Show file type</label></> : null}
    {children}
    {error ? <Banner tone="err">{error}</Banner> : null}
    <div class="sg-assets-actions"><Button disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" disabled={disabled || busy || !valid} onClick={() => { setBusy(true); setError(null); void onSubmit(value).catch((error) => setError(error.message)).finally(() => setBusy(false)); }}>{busy ? "Saving usage…" : "Use in content"}</Button></div>
  </fieldset>;
}
