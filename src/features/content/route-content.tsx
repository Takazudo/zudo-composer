import type { JSX } from "preact";
import type { ContentRouteContentProps } from "./content-app";
import { ContentApp } from "./content-app";
import { renderMarkdownPreview } from "./markdown-editor";
import { ContentMarkdownPreviewContext } from "./markdown-preview-context";
import "./styles.css";

/** Route content exported for the application shell to wire to its Content provider. */
export function ContentRouteContent(props: ContentRouteContentProps): JSX.Element {
  return <ContentMarkdownPreviewContext.Provider value={renderMarkdownPreview}><ContentApp {...props} /></ContentMarkdownPreviewContext.Provider>;
}
