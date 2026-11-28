import { signal } from "@takazudo/zfb/zudo-react";
import { afterEach, describe, expect, it } from "vitest";
import type { AssetSummary } from "../../../assets";
import { cleanup, render, screen } from "../../../test/render";
import { AssetDetailPanel } from "../assets-detail";
import { createAssetDimensions } from "../assets-dimensions";

afterEach(cleanup);

const record: AssetSummary = {
  id: "hero-image", fileName: "hero.webp", mimeType: "image/webp", byteLength: 4300,
  checksum: `sha256-${"a".repeat(64)}`, versionId: "version-1", revision: 1,
  url: `/uploaded-assets/sha256-${"a".repeat(64)}.webp`, authoringUrl: "/uploaded-assets/asset-hero-image",
  createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z", state: "active", folderId: null, note: "",
};

describe("Asset detail panel", () => {
  it("names each read-only copy field by its Field label", () => {
    render(<AssetDetailPanel record={signal<AssetSummary | null>(record)} dimensions={createAssetDimensions()} onCopyUrl={() => {}} onCopyMarkdown={() => {}} onDelete={() => {}} />);
    for (const name of ["Public URL", "Markdown"]) {
      const input = screen.getByRole("textbox", { name });
      expect(input).toHaveAttribute("readonly");
      expect(document.querySelector(`label[for="${input.id}"]`)).toHaveTextContent(name);
    }
  });
});
