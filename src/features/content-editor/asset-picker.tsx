import type { JSX } from "preact";
import { Dialog } from "../../components/overlay";
import { Button } from "../../components/ui";
import type { ContentAssetCatalogItem, ContentAssetCatalogSource } from "../content/controller";
import { makeContentAssetUse } from "../content/asset-use-card";
import type { ContentAssetPickerRenderer } from "../content/structured-field-editor";

/** One committed, approved asset the host serves read-only. */
export interface ContentEditorAsset {
  readonly assetId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly byteLength: number;
  /** Where the editor loads the thumbnail from; never written into Content. */
  readonly url: string;
  readonly label?: string;
  readonly createdAt?: string;
}

/** The host's committed asset manifest; only ids the policy approves are offered. */
export interface ContentEditorAssetCatalog {
  readonly providerId: string;
  readonly label?: string;
  readonly assets: readonly ContentEditorAsset[];
}

const EPOCH = "1970-01-01T00:00:00.000Z";

export function hostedAssetCatalogItems(catalog: ContentEditorAssetCatalog, approved: readonly string[]): ContentAssetCatalogItem[] {
  return catalog.assets.filter((asset) => approved.includes(asset.assetId)).map((asset) => ({
    providerId: catalog.providerId,
    assetId: asset.assetId,
    label: asset.label ?? asset.fileName,
    fileName: asset.fileName,
    // The host manifest is the source of truth for its committed files' types.
    mimeType: asset.mimeType as ContentAssetCatalogItem["mimeType"],
    byteLength: asset.byteLength,
    url: asset.url,
    authoringUrl: asset.url,
    createdAt: asset.createdAt ?? EPOCH,
    state: "active",
  }));
}

export function hostedAssetSource(catalog: ContentEditorAssetCatalog, approved: readonly string[]): ContentAssetCatalogSource {
  const items = hostedAssetCatalogItems(catalog, approved);
  return {
    descriptor: { id: catalog.providerId, label: catalog.label ?? "Approved assets" },
    store: { list: async () => items.map((item) => ({ id: item.assetId, fileName: item.fileName, mimeType: item.mimeType, byteLength: item.byteLength, url: item.url, authoringUrl: item.authoringUrl, createdAt: item.createdAt, state: item.state })) },
  };
}

/**
 * Selection from the approved catalog only: no upload, no replacement of
 * bytes, no URL entry. `assetPickerCapabilities.upload` is always false here.
 */
export function createHostedAssetPicker(items: readonly ContentAssetCatalogItem[], labels: { title: string; choose: string; empty: string }): ContentAssetPickerRenderer {
  return (request) => (
    <Dialog open title={labels.title} size="wide" onClose={request.onClose}>
      {items.length === 0 ? <p class="sg-hosted-asset-picker__empty">{labels.empty}</p> : (
        <ul class="sg-hosted-asset-picker" role="list">
          {items.filter((item) => request.kind !== "image" || item.mimeType.startsWith("image/")).map((item): JSX.Element => {
            const current = request.current?.providerId === item.providerId && request.current.assetId === item.assetId;
            return (
              <li key={item.assetId} class="sg-hosted-asset-picker__item" data-current={current || undefined}>
                {item.mimeType.startsWith("image/") ? <img class="sg-hosted-asset-picker__thumb" src={item.url} alt="" /> : null}
                <span class="sg-hosted-asset-picker__name">{item.label}</span>
                <Button size="sm" variant={current ? "default" : "primary"} aria-label={`${labels.choose}: ${item.label}`} onClick={() => request.onSelect(makeContentAssetUse(request.kind, item))}>{labels.choose}</Button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
