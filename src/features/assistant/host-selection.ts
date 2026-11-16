import { z } from "zod";
import type { HostSelection } from "./host-review-types";
import { hostSelectionSchema } from "../../shared/host-selection";
const name = z.string().min(1).max(256);
const prefix = "zudo-host-assistant-selection-v1:";
/** Same-tab bounded identity handoff; never stores candidate bytes or approval credentials. */
export function writeHostSelection(storage: Storage, workspaceId: string, selection: HostSelection): void {
  const parsed = hostSelectionSchema.parse(selection), pointer = `${prefix}${workspaceId}`;
  const previous = storage.getItem(pointer);
  if (previous?.startsWith(`${pointer}:`)) storage.removeItem(previous);
  const key = `${pointer}:${crypto.randomUUID()}`;
  storage.setItem(key, JSON.stringify({ workspaceId, selection: parsed, at: Date.now() }));
  storage.setItem(pointer, key);
}
export function takeHostSelection(storage: Storage, workspaceId: string): HostSelection | null {
  const pointer = `${prefix}${workspaceId}`, key = storage.getItem(pointer);
  if (!key) return null;
  storage.removeItem(pointer);
  if (!key.startsWith(`${pointer}:`)) throw new Error("Invalid Assistant selection handoff.");
  const raw = storage.getItem(key); storage.removeItem(key);
  if (!raw || raw.length > 8000) throw new Error("Assistant selection expired or is unavailable. Select the saved page again.");
  const value = z.object({ workspaceId: name, selection: hostSelectionSchema, at: z.number().finite() }).strict().parse(JSON.parse(raw));
  if (value.workspaceId !== workspaceId || Date.now() - value.at > 600_000 || value.at > Date.now() + 1000) throw new Error("Assistant selection expired. Select the saved page again.");
  return value.selection;
}

export { hostSelectionSchema } from "../../shared/host-selection";
