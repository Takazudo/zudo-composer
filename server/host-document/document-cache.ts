import { randomBytes } from "node:crypto";

/** Immutable preview responses only. GET never captures or changes canonical state. */
export function createHostDocumentCache({ limit = 32, lifetimeMs = 15 * 60_000, now = Date.now } = {}) {
  const entries = new Map<string, { html: string; expires: number }>();
  const prune = () => { for (const [key, value] of entries) if (value.expires <= now()) entries.delete(key); };
  return {
    put(html: string, visitorUrl = "/"): string {
      prune();
      while (entries.size >= limit) entries.delete(entries.keys().next().value!);
      const hashAt = visitorUrl.indexOf("#");
      const route = hashAt < 0 ? visitorUrl : visitorUrl.slice(0, hashAt);
      const fragment = hashAt < 0 ? "" : visitorUrl.slice(hashAt);
      const path = `${route}${route.includes("?") ? "&" : "?"}__zudo_host_document=${randomBytes(32).toString("hex")}`;
      entries.set(path, { html, expires: now() + lifetimeMs });
      return path + fragment;
    },
    get(path: string): string | undefined { prune(); return entries.get(path)?.html; },
  };
}
