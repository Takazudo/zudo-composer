import { downloadAsset } from "../browser/asset-download.mjs";
import { ASSET_MAX_BYTE_LENGTH } from "../assets/model";
import { Fragment, h, type ComponentChildren } from "preact";
import type { ComponentManifest } from "@zudo-composer/component-contract";
import { assetDownloadLabel, downloadMarkdownProperty, splitAssetDownloadMarkdown } from "../assets/integration/download";

function MarkdownChunk({ props, render }: { props: Record<string, unknown>; render: (props: Record<string, unknown>) => ComponentChildren }): ComponentChildren { return render(props); }

/** Native links bypass the pack's prose sanitizer; ordinary chunks still use it. */
export function renderAssetDownloadMarkdown(definition: ComponentManifest, props: Record<string, unknown>, render: (props: Record<string, unknown>) => ComponentChildren): ComponentChildren {
  const property = downloadMarkdownProperty(definition, props);
  if (!property) return render(props);
  const parts = splitAssetDownloadMarkdown(props[property] as string);
  if (!parts.some((part) => "block" in part)) return render(props);
  return h(Fragment, null, parts.map((part, index) => h(Fragment, { key: index }, "markdown" in part
    ? part.markdown.trim() ? h(MarkdownChunk, { props: { ...props, [property]: part.markdown }, render }) : null
    : part.block.resolved ? h("a", { "aria-label": assetDownloadLabel(part.block), href: part.block.resolved.url, download: part.block.resolved.fileName, onClick: (event: MouseEvent) => { void downloadAsset(event, ASSET_MAX_BYTE_LENGTH); } }, assetDownloadLabel(part.block))
      : h("span", { role: "status" }, "Download unavailable"))));
}
