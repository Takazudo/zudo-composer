import { h, type ComponentType } from "preact";
import { activeComponentProvider } from "../composer/active-pack";

/**
 * The configured pack's Markdown renderer, if it has one.
 *
 * The component contract has no "renders Markdown" role, so the seam is the
 * public export name: a pack exporting `ProseMd` is the one the Content editor
 * previews with. Reaching for the package by name instead would pin the editor
 * to one pack and pull it into the bundle even when a themeset is configured.
 *
 * A pack without such a component still leaves a working editor — the source
 * pane is untouched and the preview shows the Markdown as written.
 */
const proseMd = activeComponentProvider.runtimeEntries.find(
  ({ manifest }) => manifest.source.exportName === "ProseMd",
)?.runtime.component as ComponentType<{ markdown: string }> | undefined;

export function MarkdownPreview({ markdown }: { markdown: string }) {
  if (!proseMd) return <pre class="sg-content-markdown-editor__plain">{markdown}</pre>;
  return h(proseMd, { markdown });
}
