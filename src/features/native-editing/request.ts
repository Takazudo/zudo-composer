import { z } from "zod";
import type { NativeInsertion } from "./types";
const table = z.object({ columns: z.array(z.string()).min(1).max(100), rows: z.array(z.array(z.string())).min(1).max(1000) }).strict().refine(value => value.rows.every(row => row.length === value.columns.length), "Each row must have one supplied cell per column.");
export function exactInsertion(kind: "text" | "image" | "table", text: string, assetId: string, alt: string): NativeInsertion {
  if (kind === "text") return { kind, text: z.string().min(1).max(100_000).parse(text) };
  if (kind === "image") return { kind, assetId: z.string().min(1).max(256).parse(assetId), alt: z.string().max(10_000).parse(alt) };
  return { kind, ...table.parse(JSON.parse(text)) };
}
export function isCompositionEnter(event: { key: string; isComposing?: boolean; keyCode?: number }): boolean {
  return event.key === "Enter" && (event.isComposing === true || event.keyCode === 229);
}
