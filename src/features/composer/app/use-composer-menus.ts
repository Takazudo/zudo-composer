"use client";

// The Composer's context-menu orchestration hook (issue Takazudo/zudo-sg#256) — the ONE place
// that turns a "⋯" activation (from a tree row, a tree insert affordance, or
// the canvas relay) into a positioned `<ComposerMenu>` with the right items,
// wired EXCLUSIVELY through Takazudo/zudo-sg#255's wave-6 controller actions (copy/cut/
// paste/duplicate/remove) — no second mutation path.
//
// ── Menu content is DERIVED, not stored ─────────────────────────────────────
// Only WHICH menu is open (node vs insert, its subject, its anchor, and how
// to restore focus on close) is state. The item list itself is recomputed
// from the live `controller.state` on every render, so an action elsewhere
// (e.g. Takazudo/zudo-sg#251's guarded Delete/Backspace) can never leave a menu showing
// stale Copy/Cut/Duplicate affordances for a node that already changed.
//
// ── Two distinct "close" paths ──────────────────────────────────────────────
// `close()` invokes the caller-supplied `restoreFocus` thunk before clearing
// state — the ONE seam that differs between origins: a tree trigger's thunk
// just calls `.focus()` on itself; the canvas relay's thunk calls
// `bridge.restoreFocus(focusToken)` (see `composer-canvas-host.tsx`), which
// round-trips over the bridge so the IFRAME can restore focus to its own
// control (issue Takazudo/zudo-sg#256's cross-frame focus contract).
//
// "Add component…" is the one exception: it hands off to the EXISTING
// Takazudo/zudo-sg#251 add flow (open the shared chooser, which owns its own focus capture/
// restore), so it closes SILENTLY — no `restoreFocus`, which would otherwise
// race the chooser's synchronous `document.activeElement` capture with an
// asynchronous cross-frame focus round-trip.
//
// ── Delete confirmation reuses Takazudo/zudo-sg#250's exact copy/behavior ───────────────────
// Selecting Delete on a node with descendants swaps the menu's `items` for
// `SubtreeRemovalConfirm`'s `children` (same component the tree row's own
// inline confirmation uses) instead of removing immediately.

import { useCallback, useMemo, useState } from "preact/hooks";
import type { InsertionTarget } from "../../../composer/browser";
import { findLocation, isNodeOpaque } from "../../../composer/browser";
import { CopyIcon, CutIcon, DuplicateIcon, PlusIcon, TrashIcon } from "../../../components/icons";
import type { ComposerMenuItemSpec } from "../ui/menu/composer-menu";
import { anchorBelowRect, type MenuPoint } from "../ui/menu/menu-position";
import { buildCatalogById, countDescendants, summarizeNode } from "../ui/tree/tree-helpers";
import type { ComposerIntegrationApi } from "./use-composer-integration";

/** A `getBoundingClientRect()`-shaped value in HOST viewport coordinates. */
export interface MenuAnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ClosedMenu {
  open: false;
}

interface NodeMenu {
  open: true;
  kind: "node";
  nodeId: string;
  anchor: MenuPoint;
  restoreFocus: () => void;
  confirmingDelete: boolean;
}

interface InsertMenu {
  open: true;
  kind: "insert";
  target: InsertionTarget;
  anchor: MenuPoint;
  restoreFocus: () => void;
  /** Defaults to `api.openChooser(target)` — the canvas relay overrides this to focus the iframe first (see `composer-canvas-host.tsx`). */
  addComponent: () => void;
}

type MenuState = ClosedMenu | NodeMenu | InsertMenu;

const CLOSED: MenuState = { open: false };

export interface ComposerMenuConfirmContent {
  nodeTitle: string;
  descendantCount: number;
}

export interface ComposerMenusApi {
  open: boolean;
  /** Accessible name for the current menu (or its confirmation sub-view). */
  label: string;
  anchor: MenuPoint | null;
  /** The item list, or `null` while `confirm` is showing instead. */
  items: readonly ComposerMenuItemSpec[] | null;
  /** Non-null while Delete's subtree-removal confirmation replaces the item list. */
  confirm: ComposerMenuConfirmContent | null;
  /** Escape / outside click / scroll / resize / Cancel — restores focus, then closes. */
  onClose: () => void;
  onConfirmDelete: () => void;
  onCancelConfirm: () => void;

  // ── Generic openers (rect + explicit restoreFocus — canvas relay uses these directly) ──
  openNodeMenu: (nodeId: string, rect: MenuAnchorRect, restoreFocus: () => void) => void;
  openInsertMenu: (
    target: InsertionTarget,
    rect: MenuAnchorRect,
    restoreFocus: () => void,
    addComponent?: () => void,
  ) => void;

  // ── Tree convenience wrappers — match ComposerTree's `(id/target, trigger)` callback shape ──
  handleTreeOpenNodeMenu: (nodeId: string, trigger: HTMLElement) => void;
  handleTreeOpenInsertMenu: (target: InsertionTarget, trigger: HTMLElement) => void;
}

export function useComposerMenus(api: ComposerIntegrationApi): ComposerMenusApi {
  const { controller, manifestEntries, titleFor } = api;
  const manifest = controller.manifest;
  const [menu, setMenu] = useState<MenuState>(CLOSED);

  const catalogById = useMemo(() => buildCatalogById(manifestEntries), [manifestEntries]);

  /** Clear the menu WITHOUT invoking `restoreFocus` — the "Add component…" hand-off. */
  const closeSilently = useCallback(() => setMenu(CLOSED), []);

  /** The normal close path: restore focus to the originating control, then clear. */
  const close = useCallback(() => {
    if (menu.open) menu.restoreFocus();
    closeSilently();
  }, [menu, closeSilently]);

  const onConfirmDelete = useCallback(() => {
    if (menu.open && menu.kind === "node") controller.remove(menu.nodeId);
    close();
  }, [menu, controller, close]);

  const onCancelConfirm = useCallback(() => close(), [close]);

  const openNodeMenu = useCallback((nodeId: string, rect: MenuAnchorRect, restoreFocus: () => void) => {
    setMenu({ open: true, kind: "node", nodeId, anchor: anchorBelowRect(rect), restoreFocus, confirmingDelete: false });
  }, []);

  const openInsertMenu = useCallback(
    (target: InsertionTarget, rect: MenuAnchorRect, restoreFocus: () => void, addComponentOverride?: () => void) => {
      setMenu({
        open: true,
        kind: "insert",
        target,
        anchor: anchorBelowRect(rect),
        restoreFocus,
        addComponent: addComponentOverride ?? (() => api.openChooser(target)),
      });
    },
    [api],
  );

  const handleTreeOpenNodeMenu = useCallback(
    (nodeId: string, trigger: HTMLElement) => {
      openNodeMenu(nodeId, trigger.getBoundingClientRect(), () => trigger.focus());
    },
    [openNodeMenu],
  );

  const handleTreeOpenInsertMenu = useCallback(
    (target: InsertionTarget, trigger: HTMLElement) => {
      openInsertMenu(target, trigger.getBoundingClientRect(), () => trigger.focus());
    },
    [openInsertMenu],
  );

  const derived = useMemo((): {
    label: string;
    items: readonly ComposerMenuItemSpec[] | null;
    confirm: ComposerMenuConfirmContent | null;
  } => {
    if (!menu.open) return { label: "", items: null, confirm: null };

    if (menu.kind === "node") {
      const location = findLocation(controller.state.document, manifest, menu.nodeId);
      // The node vanished from under an open menu (a rare race) — nothing to
      // show; Escape/outside-click still closes it normally.
      if (!location) return { label: "Menu", items: [], confirm: null };

      const summary = summarizeNode(location.node, manifest, catalogById);
      const displayName = summary.subtitle ? `${summary.title} ${summary.subtitle}` : summary.title;

      if (menu.confirmingDelete) {
        return {
          label: `Confirm removing ${displayName}`,
          items: null,
          confirm: { nodeTitle: displayName, descendantCount: countDescendants(location.node) },
        };
      }

      const opaque = isNodeOpaque(location.node, manifest);
      const items: ComposerMenuItemSpec[] = [];
      if (!opaque) {
        items.push({
          id: "copy",
          label: "Copy",
          icon: CopyIcon,
          onSelect: () => { controller.copy(menu.nodeId); close(); },
        });
        items.push({
          id: "cut",
          label: "Cut",
          icon: CutIcon,
          onSelect: () => { controller.cut(menu.nodeId); close(); },
        });
        items.push({
          id: "duplicate",
          label: "Duplicate",
          icon: DuplicateIcon,
          onSelect: () => { controller.duplicate(menu.nodeId); close(); },
        });
      }
      items.push({
        id: "delete",
        label: "Delete",
        danger: true,
        icon: TrashIcon,
        onSelect: () => {
          if (countDescendants(location.node) > 0) {
            setMenu((prev) => (prev.open && prev.kind === "node" ? { ...prev, confirmingDelete: true } : prev));
            return;
          }
          controller.remove(menu.nodeId);
          close();
        },
      });
      return { label: `${displayName} menu`, items, confirm: null };
    }

    // Insert menu: "Add component…" AND "Paste here" are BOTH always present.
    const clipboard = controller.state.clipboard;
    const clipboardLabel = clipboard ? (titleFor(clipboard.componentId) ?? clipboard.componentId) : null;
    const items: ComposerMenuItemSpec[] = [
      {
        id: "add",
        label: "Add component…",
        icon: PlusIcon,
        onSelect: () => {
          const addComponent = menu.addComponent;
          closeSilently();
          addComponent();
        },
      },
      {
        id: "paste",
        label: clipboardLabel ? `Paste "${clipboardLabel}" here` : "Paste here",
        disabled: clipboard === null,
        onSelect: () => { controller.paste(menu.target); close(); },
      },
    ];
    return { label: "Insert menu", items, confirm: null };
  }, [menu, controller, manifest, catalogById, titleFor, close, closeSilently]);

  return {
    open: menu.open,
    label: derived.label,
    anchor: menu.open ? menu.anchor : null,
    items: derived.items,
    confirm: derived.confirm,
    onClose: close,
    onConfirmDelete,
    onCancelConfirm,
    openNodeMenu,
    openInsertMenu,
    handleTreeOpenNodeMenu,
    handleTreeOpenInsertMenu,
  };
}
