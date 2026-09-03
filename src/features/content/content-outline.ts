// The Content library as the shared outline tree sees it (issue #169).
//
// `OutlineTree` knows nothing about Content: it renders `OutlineNode`s. This
// module is the whole translation, kept pure so the rules that decide what the
// navigator shows are testable without a DOM:
//
//   1. Every model is a root `category` — the `»` row carrying its id, its
//      Entry count, a `single` tag for Singles, and a warn dot as soon as one
//      of its Entries is missing a required value.
//   2. Only the OPEN model has children. The controller holds one model's
//      Entries at a time, so every other category is childless and therefore
//      not expandable: selecting it is what loads it and gives it children.
//   3. The first page of Entries renders as leaves, newest first, and a further
//      page is offered by one trailing "N more entries…" row rather than by a
//      button outside the tree.

import type { OutlineNode, OutlineStatus } from "../../components/outline-tree";
import type { ContentEntryRecord, ContentModelRecord, ContentModelSummary } from "../../content";
import { contentEntryLabel, contentEntrySlug } from "./presentation";

/** Prefix of the synthetic row that pages the rest of a model's Entries in. */
export const CONTENT_MORE_ROW_PREFIX = "content-more:";

export function contentMoreRowId(modelId: string): string {
  return `${CONTENT_MORE_ROW_PREFIX}${modelId}`;
}

export function isContentMoreRowId(id: string): boolean {
  return id.startsWith(CONTENT_MORE_ROW_PREFIX);
}

const INCOMPLETE: OutlineStatus = { tone: "warn", label: "Incomplete" };
const COMPLETE: OutlineStatus = { tone: "ok", label: "Complete" };

export interface ContentOutlineInput {
  models: readonly ContentModelSummary[];
  entryCounts: Readonly<Record<string, number>>;
  /** Absent for a model that has not been scanned; it then shows no dot. */
  incompleteCounts: Readonly<Record<string, number>>;
  /** The one model whose Entries are loaded, or `null` before one is opened. */
  openModel: ContentModelRecord | null;
  /** The open model's first page, newest first. */
  entries: readonly ContentEntryRecord[];
  /** Present while the open model has a further page to load. */
  hasMoreEntries: boolean;
  /** Decides an Entry's dot; the controller's completeness diagnosis. */
  isEntryIncomplete: (entry: ContentEntryRecord) => boolean;
}

function modelStatus(incomplete: number | undefined): OutlineStatus | undefined {
  if (incomplete === undefined) return undefined;
  return incomplete > 0 ? { tone: "warn", label: `${incomplete} incomplete` } : COMPLETE;
}

/** Translate the Content library into the navigator's rows. */
export function buildContentOutline(input: ContentOutlineInput): OutlineNode[] {
  return input.models.map((model) => {
    const open = input.openModel?.id === model.id ? input.openModel : null;
    const fields = open?.document.fields ?? [];
    const children: OutlineNode[] = open === null ? [] : input.entries.map((entry) => ({
      id: entry.id,
      kind: "leaf" as const,
      title: contentEntryLabel(entry, fields),
      slug: contentEntrySlug(entry, fields),
      ...(input.isEntryIncomplete(entry) ? { status: INCOMPLETE } : {}),
    }));

    if (open !== null && input.hasMoreEntries) {
      const remaining = Math.max(0, (input.entryCounts[model.id] ?? input.entries.length) - input.entries.length);
      children.push({
        id: contentMoreRowId(model.id),
        kind: "leaf",
        // Named by what it does rather than by a count of one, so the row still
        // reads correctly when the total is not yet known.
        title: remaining > 0 ? `${remaining} more ${remaining === 1 ? "entry" : "entries"}…` : "More entries…",
      });
    }

    const status = modelStatus(input.incompleteCounts[model.id]);
    return {
      id: model.id,
      kind: "category" as const,
      title: model.name,
      slug: model.id,
      count: input.entryCounts[model.id] ?? 0,
      ...(model.kind === "single" ? { tag: "single" } : {}),
      ...(status ? { status } : {}),
      children,
    };
  });
}
