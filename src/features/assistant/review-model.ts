import type { ReviewAnnotation, ReviewAnnotations } from "../composer/preview/protocol";
import type { DraftChange } from "./types";

type Span = [number, number];
interface Token { text: string; start: number; end: number; space: boolean }
// Han/Kana have no spaces between words, so each character is its own token.
const TOKEN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|\s+/gu;
export function tokenize(text: string): Token[] {
  return [...text.matchAll(TOKEN)].map(match => ({ text: match[0], start: match.index!, end: match.index! + match[0].length, space: /^\s+$/.test(match[0]) }));
}
const merge = (spans: Span[]): Span[] => spans.reduce<Span[]>((all, span) => {
  const last = all.at(-1);
  if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]); else all.push([...span]);
  return all;
}, []);

/** Word-level diff. `insert` spans index the new text; `remove` spans index the old text. Whitespace-only edits are not highlighted. */
export function wordDiff(before: string, after: string): { insert: Span[]; remove: Span[] } {
  const a = tokenize(before), b = tokenize(after);
  if (a.length * b.length > 4_000_000) return { insert: after.trim() ? [[0, after.length]] : [], remove: before.trim() ? [[0, before.length]] : [] };
  const lcs: Uint32Array[] = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i]![j] = a[i]!.text === b[j]!.text ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const insert: Span[] = [], remove: Span[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i]!.text === b[j]!.text) { i++; j++; continue; }
    if (j < b.length && (i >= a.length || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) { if (!b[j]!.space) insert.push([b[j]!.start, b[j]!.end]); j++; }
    else { if (!a[i]!.space) remove.push([a[i]!.start, a[i]!.end]); i++; }
  }
  // Join adjacent changed words (and the space between them) into one visual mark.
  const bridge = (spans: Span[], text: string) => merge(spans.map(([start, end], index) => {
    const next = spans[index + 1];
    return next && /^\s*$/.test(text.slice(end, next[0])) ? [start, next[0]] as Span : [start, end] as Span;
  }));
  return { insert: bridge(insert, after), remove: bridge(remove, before) };
}

/** Every string leaf of a JSON field value, addressed by a stable path (list items, table cells). */
export function stringLeaves(value: unknown, path = ""): { path: string; text: string }[] {
  if (typeof value === "string") return [{ path, text: value }];
  if (Array.isArray(value)) return value.flatMap((item, index) => stringLeaves(item, `${path}/${index}`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => stringLeaves(item, `${path}/${key}`));
  return [];
}

type Text = ReviewAnnotation["texts"][number];
function fieldTexts(before: unknown, after: unknown, view: "current" | "draft"): Text[] {
  const old = new Map(stringLeaves(before).map(leaf => [leaf.path, leaf.text]));
  const next = new Map(stringLeaves(after).map(leaf => [leaf.path, leaf.text]));
  const texts: Text[] = [];
  if (view === "draft") for (const [path, text] of next) {
    const prior = old.get(path);
    if (prior === text || !text.trim()) continue;
    texts.push({ text, ranges: prior === undefined ? [[0, text.length]] : wordDiff(prior, text).insert, tone: "insert" });
  } else for (const [path, text] of old) {
    const later = next.get(path);
    if (later === text || !text.trim()) continue;
    texts.push({ text, ranges: later === undefined ? [[0, text.length]] : wordDiff(text, later).remove, tone: "delete" });
  }
  return texts.filter(text => text.ranges.length);
}

/**
 * Builds the annotations for one page and view. Annotations are keyed to the
 * candidate digest, page and view so stale marks can never survive a revision.
 */
/** Whether a prop is rendered as words (text editors and lists of them); icons, URLs and enums are not. */
export type TextFieldTest = (componentId: string, prop: string) => boolean;
export function buildReviewAnnotations(changes: readonly DraftChange[], key: string, view: "current" | "draft", isText: TextFieldTest = () => true): ReviewAnnotations {
  const byNode = new Map<string, DraftChange[]>();
  for (const change of changes) {
    if (view === "current" && change.kind === "added") continue;
    if (view === "draft" && change.kind === "removed") continue;
    byNode.set(change.nodeId, [...byNode.get(change.nodeId) ?? [], change]);
  }
  const groups = [...byNode.values()];
  const items: ReviewAnnotation[] = groups.map((group, index) => {
    const added = group.find(change => change.kind === "added"), removed = group.find(change => change.kind === "removed");
    const kind = added ? "added" : removed ? "removed" : "changed";
    const componentId = group[0]!.componentId;
    const texts = added ? Object.entries(added.props ?? {}).filter(([prop]) => isText(componentId, prop)).flatMap(([, value]) => fieldTexts(undefined, value, "draft"))
      : removed ? Object.entries(removed.props ?? {}).filter(([prop]) => isText(componentId, prop)).flatMap(([, value]) => fieldTexts(value, undefined, "current"))
        : group.filter(change => change.prop && isText(componentId, change.prop)).flatMap(change => fieldTexts(change.before, change.after, view));
    return {
      id: annotationId(group[0]!), kind, nodeId: group[0]!.nodeId,
      label: kind === "added" ? "Added" : kind === "removed" ? "Removed" : view === "current" ? "Will change" : "Changed",
      ordinal: index + 1, total: groups.length, texts: texts.slice(0, 500),
    };
  });
  return { key, view, items };
}
export const annotationId = (change: Pick<DraftChange, "recordId" | "nodeId">) => `${change.recordId}:${change.nodeId}`;
