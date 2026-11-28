import { computed, For, type Child, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import type { AssetSummary } from "../../assets";
import type { IconComponent, IconSize } from "../../components/icons";

/**
 * The identity of an asset's rendered view: what a tile, row or thumbnail
 * shows. A refresh that recreates summaries with the same content keeps the
 * DOM (and focus); a rename, replacement or move remounts that one view.
 */
export function assetViewKey(record: AssetSummary): string {
  return JSON.stringify([record.id, record.versionId, record.url, record.fileName, record.mimeType, record.byteLength, record.revision, record.state, record.folderId, record.note, record.createdAt, record.updatedAt]);
}

/** Renders `children` for the record behind `record`, remounted per `assetViewKey`. */
export function AssetView({ record, children }: { record: ReadonlySignal<AssetSummary>; children: (record: AssetSummary) => Child }): Child {
  const items = computed(() => [record.value]);
  return <For each={items} by={assetViewKey}>{(item) => children(item.value)}</For>;
}

const iconIds = new WeakMap<IconComponent, number>();
let nextIconId = 0;
function iconId(icon: IconComponent): number {
  let id = iconIds.get(icon);
  if (id === undefined) { id = ++nextIconId; iconIds.set(icon, id); }
  return id;
}

/** An icon chosen at runtime: a one-item `For` keyed by the component. */
export function LiveIcon({ icon, size }: { icon: ReadonlySignal<IconComponent>; size?: IconSize }): Child {
  const items = computed(() => [icon.value]);
  return <For each={items} by={iconId}>{(item) => { const Icon = item.value; return <Icon size={size} />; }}</For>;
}
