// Which formatted Markdown preview the Entry form offers. The local route
// supplies the configured pack's renderer; a hosted editor supplies none and
// keeps the component pack out of its module graph.
import type { JSX } from "preact";
import { createContext } from "preact";

export const ContentMarkdownPreviewContext = createContext<((markdown: string) => JSX.Element) | undefined>(undefined);
