import { getScope, Show, signal, type Child, type Ref } from "@takazudo/zfb/zudo-react";
import { assetKindForMime, type AssetSummary } from "../../assets";
import { FileIcon, FolderIcon, TextIcon } from "../../components/icons";
import type { AssetDimensionStore } from "./assets-dimensions";
import { assetTypeLabel, isAssetImage } from "./assets-format";

export interface AssetThumbProps {
  record: AssetSummary;
  dimensions: AssetDimensionStore;
  /** The larger preview in the detail panel. */
  detail?: boolean;
}

/**
 * The asset itself for an image, a kind icon and extension badge for other files.
 *
 * The image is the public URL the rest of the app references, so a thumbnail
 * that renders is also proof the delivered bytes decode — and the decode is
 * where the natural dimensions come from, since the Asset model stores none.
 * The record is fixed for the thumb's lifetime; callers remount it per version.
 */
export function AssetThumb({ record, dimensions, detail = false }: AssetThumbProps): Child {
  if (!isAssetImage(record)) {
    const kind = assetKindForMime(record.mimeType)?.kind;
    const Icon = kind === "archive" ? FolderIcon : kind === "text" ? TextIcon : FileIcon;
    return (
      <span class={`sg-assets-file${detail ? " sg-assets-file--detail" : ""}`} aria-hidden="true">
        <Icon size={detail ? "lg" : "md"} />
        <span class="sg-assets-file__label">{assetTypeLabel(record.mimeType)}</span>
      </span>
    );
  }
  const failed = signal(false);
  const image: Ref<HTMLImageElement> = { current: null };
  // A cached image can already be decoded before `load` would fire, so the
  // mounted element reports too; both paths are idempotent in the store.
  getScope().onActivate(() => dimensions.record(record.versionId, image.current));
  return (
    <Show when={failed} fallback={() => (
      <img
        ref={image}
        class="sg-assets-image"
        src={record.url}
        alt=""
        loading={detail ? undefined : "lazy"}
        on:load={(event) => dimensions.record(record.versionId, event.currentTarget)}
        on:error={() => { failed.value = true; }}
      />
    )}>
      {() => <span role="status">Image preview unavailable</span>}
    </Show>
  );
}
