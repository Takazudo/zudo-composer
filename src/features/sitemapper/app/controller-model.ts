import type { IdFactory } from "../../../shared";
import {
  addChildPage,
  addRootPage,
  addSiblingPage,
  duplicatePage,
  movePage,
  removePage,
  reorderPage,
  updatePageProps,
  type SitemapCommandResult,
  type SitemapPagePropsPatch,
} from "../../../sitemapper/commands";
import { traversalOrder } from "../../../sitemapper/model";
import type { SitemapDocument } from "../../../sitemapper/model";

export type SitemapperSaveStatus =
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; reason: string };

export interface SitemapperControllerState {
  document: SitemapDocument;
  selectedId: string | null;
  expandedIds: ReadonlySet<string>;
  saveStatus: SitemapperSaveStatus;
}

export type SitemapperAction =
  | { type: "addChild"; parentId: string; title: string; atIndex?: number }
  | { type: "addRoot"; title: string }
  | { type: "rename"; name: string }
  | { type: "addSibling"; pageId: string; title: string; atIndex?: number }
  | { type: "updateProps"; pageId: string; patch: SitemapPagePropsPatch }
  | { type: "remove"; pageId: string }
  | { type: "duplicate"; pageId: string }
  | { type: "move"; pageId: string; targetParentId: string | null; targetIndex: number }
  | { type: "reorder"; pageId: string; direction: "up" | "down" }
  | { type: "select"; pageId: string | null }
  | { type: "toggleExpanded"; pageId: string }
  | { type: "setExpanded"; pageId: string; expanded: boolean }
  | { type: "setExpandedIds"; pageIds: readonly string[] };

export interface SitemapperReducerResult {
  state: SitemapperControllerState;
  error: string | null;
  documentChanged: boolean;
}

export function createInitialSitemapperControllerState(
  document: SitemapDocument,
  saveStatus: SitemapperSaveStatus = { kind: "saved" },
): SitemapperControllerState {
  return {
    document,
    selectedId: document.root[0]?.id ?? null,
    // A freshly opened outline shows the whole tree; a collapsed-by-default
    // rail would hide every page an author is about to work on.
    expandedIds: new Set(traversalOrder(document)),
    saveStatus,
  };
}

function expanded(ids: ReadonlySet<string>, pageId: string, value: boolean): ReadonlySet<string> {
  if (ids.has(pageId) === value) return ids;
  const next = new Set(ids);
  if (value) next.add(pageId);
  else next.delete(pageId);
  return next;
}

function commandResult(
  state: SitemapperControllerState,
  result: SitemapCommandResult,
): SitemapperReducerResult {
  if (!result.ok) return { state, error: result.error, documentChanged: false };
  if (!result.changed) return { state, error: null, documentChanged: false };
  return {
    state: { ...state, document: result.document, selectedId: result.selectedId },
    error: null,
    documentChanged: true,
  };
}

export function applySitemapperAction(
  state: SitemapperControllerState,
  action: SitemapperAction,
  idFactory: IdFactory,
): SitemapperReducerResult {
  switch (action.type) {
    case "addChild":
      return commandResult(state, addChildPage(state.document, action.parentId, action.title, idFactory, action.atIndex));
    case "addRoot":
      return commandResult(state, addRootPage(state.document, action.title, idFactory));
    case "rename":
      return action.name === state.document.name
        ? { state, error: null, documentChanged: false }
        : {
            state: { ...state, document: { ...state.document, name: action.name } },
            error: null,
            documentChanged: true,
          };
    case "addSibling":
      return commandResult(state, addSiblingPage(state.document, action.pageId, action.title, idFactory, action.atIndex));
    case "updateProps":
      return commandResult(state, updatePageProps(state.document, action.pageId, action.patch));
    case "remove":
      return commandResult(state, removePage(state.document, action.pageId, state.selectedId));
    case "duplicate":
      return commandResult(state, duplicatePage(state.document, action.pageId, idFactory));
    case "move":
      return commandResult(state, movePage(state.document, action.pageId, action.targetParentId, action.targetIndex));
    case "reorder":
      return commandResult(state, reorderPage(state.document, action.pageId, action.direction));
    case "select":
      return {
        state: action.pageId === state.selectedId ? state : { ...state, selectedId: action.pageId },
        error: null,
        documentChanged: false,
      };
    case "toggleExpanded":
      return {
        state: { ...state, expandedIds: expanded(state.expandedIds, action.pageId, !state.expandedIds.has(action.pageId)) },
        error: null,
        documentChanged: false,
      };
    case "setExpanded":
      return {
        state: { ...state, expandedIds: expanded(state.expandedIds, action.pageId, action.expanded) },
        error: null,
        documentChanged: false,
      };
    case "setExpandedIds":
      return {
        state: { ...state, expandedIds: new Set(action.pageIds) },
        error: null,
        documentChanged: false,
      };
  }
}
