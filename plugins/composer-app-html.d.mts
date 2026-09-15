import type { Plugin } from "vite";

export const APP_HTML_PATH: string;
export const APP_ENTRY_MODULE: string;
export const APP_ENTRY_HTML_SRC: string;
export function rewriteAppEntry(html: string, entryModule?: string): string;
export default function composerAppHtmlPlugin(): Plugin;
