import type { JSX } from "preact";
import type { MediaSummary } from "../../media";
import { FileIcon } from "../../components/icons";
import { mediaUrl } from "./controller";
import type { MediaDimensionStore } from "./media-dimensions";
import { isMediaImage } from "./media-format";

export interface MediaThumbProps {
  record: MediaSummary;
  dimensions: MediaDimensionStore;
  /** The larger preview in the detail panel. */
  detail?: boolean;
}

/**
 * The asset itself for an image, a page-shaped tile for a PDF.
 *
 * The image is the public URL the rest of the app references, so a thumbnail
 * that renders is also proof the delivered bytes decode — and the decode is
 * where the natural dimensions come from, since the Media model stores none.
 */
export function MediaThumb({ record, dimensions, detail = false }: MediaThumbProps): JSX.Element {
  if (!isMediaImage(record)) {
    return (
      <span class={`sg-media-pdf${detail ? " sg-media-pdf--detail" : ""}`} aria-hidden="true">
        <FileIcon size={detail ? "lg" : "md"} />
        <span class="sg-media-pdf__label">PDF</span>
      </span>
    );
  }
  return (
    <img
      class="sg-media-image"
      src={mediaUrl(record)}
      alt=""
      loading={detail ? undefined : "lazy"}
      // A cached image can already be decoded before `load` would fire, so the
      // ref reports too; both paths are idempotent in the store.
      ref={(element) => dimensions.record(record.id, element)}
      onLoad={(event) => dimensions.record(record.id, event.currentTarget)}
    />
  );
}
