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
// Delete is a single action because document mutations can be recovered
// through Composer history.

import { useCallback, useMemo, useState } from "preact/hooks";
import type { InsertionTarget } from "../../../composer/browser";
import { findLocation, isNodeOpaque } from "../../../composer/browser";
import { CopyIcon, CutIcon, DuplicateIcon, PlusIcon, TrashIcon } from "../../../components/icons";
import type { ComposerMenuItemSpec } from "../ui/menu/composer-menu";
import { anchorBelowRect, type MenuPoint } from "../ui/menu/menu-position";
import { buildCatalogById, summarizeNode } from "../ui/tree/tree-helpers";
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

export interface ComposerMenusApi {
  open: boolean;
  /** Accessible name for the current menu. */
  label: string;
  anchor: MenuPoint | null;
  items: readonly ComposerMenuItemSpec[] | null;
  /** Escape / outside click / scroll / resize / Cancel — restores focus, then closes. */
  onClose: () => void;
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

  const openNodeMenu = useCallback((nodeId: string, rect: MenuAnchorRect, restoreFocus: () => void) => {
    setMenu({ open: true, kind: "node", nodeId, anchor: anchorBelowRect(rect), restoreFocus });
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
  } => {
    if (!menu.open) return { label: "", items: null };

    if (menu.kind === "node") {
      const location = findLocation(controller.state.document, manifest, menu.nodeId);
      // The node vanished from under an open menu (a rare race) — nothing to
      // show; Escape/outside-click still closes it normally.
      if (!location) return { label: "Menu", items: [] };

      const summary = summarizeNode(location.node, manifest, catalogById);
      const displayName = summary.subtitle ? `${summary.title} ${summary.subtitle}` : summary.title;

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
          controller.remove(menu.nodeId);
          close();
        },
      });
      return { label: `${displayName} menu`, items };
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
    return { label: "Insert menu", items };
  }, [menu, controller, manifest, catalogById, titleFor, close, closeSilently]);

  return {
    open: menu.open,
    label: derived.label,
    anchor: menu.open ? menu.anchor : null,
    items: derived.items,
    onClose: close,
    openNodeMenu,
    openInsertMenu,
    handleTreeOpenNodeMenu,
    handleTreeOpenInsertMenu,
  };
}
