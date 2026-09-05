import type { SitemapDocument, SitemapNavigationItem } from "../model";
import { validSitemapNavigation } from "../model/validate";
export type SitemapMenu = "primary" | "footer";
export type SitemapNavigationCommand = { kind: "put"; item: SitemapNavigationItem; index: number } | { kind: "remove"; id: string };
export function editSitemapNavigation(document: SitemapDocument, menu: SitemapMenu, command: SitemapNavigationCommand):
  | { ok: true; document: SitemapDocument }
  | { ok: false; code: "invalid-navigation" | "item-not-found" | "invalid-index" } {
  if (menu !== "primary" && menu !== "footer") return { ok: false, code: "invalid-navigation" };
  const next = structuredClone(document), items = next.navigation[menu];
  const id = command.kind === "put" ? command.item.id : command.id;
  const prior = items.findIndex((item) => item.id === id);
  if (command.kind === "remove" && prior < 0) return { ok: false, code: "item-not-found" };
  if (prior >= 0) items.splice(prior, 1);
  if (command.kind === "put") {
    if (!Number.isSafeInteger(command.index) || command.index < 0 || command.index > items.length) return { ok: false, code: "invalid-index" };
    items.splice(command.index, 0, structuredClone(command.item));
  }
  if (!validSitemapNavigation(next.navigation)) return { ok: false, code: "invalid-navigation" };
  return { ok: true, document: next };
}
