import type { JSX } from "preact";
import { useState } from "preact/hooks";
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
 */
export function AssetThumb({ record, dimensions, detail = false }: AssetThumbProps): JSX.Element {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (failedUrl === record.url) return <span role="status">Image preview unavailable</span>;
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
  return (
    <img
      class="sg-assets-image"
      src={record.url}
      alt=""
      loading={detail ? undefined : "lazy"}
      // A cached image can already be decoded before `load` would fire, so the
      // ref reports too; both paths are idempotent in the store.
      ref={(element) => dimensions.record(record.versionId, element)}
      onLoad={(event) => dimensions.record(record.versionId, event.currentTarget)}
      onError={() => setFailedUrl(record.url)}
    />
  );
}
