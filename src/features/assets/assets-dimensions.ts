import { useCallback, useState } from "preact/hooks";
import type { AssetPixelSize } from "./assets-format";

/**
 * Natural pixel sizes, read from the images the route already renders.
 *
 * The Asset model stores no dimensions — the upload boundary records bytes and
 * a checksum, nothing more — so the only honest source is the browser's own
 * decode. Every surface that renders an asset (grid tile, list thumbnail,
 * detail preview) reports into one store, so an asset measured in the grid is
 * already measured when its detail panel opens.
 */
export interface AssetDimensionStore {
  get: (id: string) => AssetPixelSize | undefined;
  /** Records a decoded `<img>`; an undecoded or unchanged report is ignored. */
  record: (id: string, image: HTMLImageElement | null | undefined) => void;
}

export function useAssetDimensions(): AssetDimensionStore {
  const [sizes, setSizes] = useState<ReadonlyMap<string, AssetPixelSize>>(() => new Map());

  const record = useCallback((id: string, image: HTMLImageElement | null | undefined) => {
    // A broken or still-loading image reports 0×0; that is absence, not a size.
    if (!image || !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    setSizes((current) => {
      const known = current.get(id);
      if (known && known.width === width && known.height === height) return current;
      const next = new Map(current);
      next.set(id, { width, height });
      return next;
    });
  }, []);

  return { get: (id) => sizes.get(id), record };
}
