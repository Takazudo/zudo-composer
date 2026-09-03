"use client";

// The Composer's context-menu orchestration hook — the ONE place that turns a
// "⋯" activation (from a structure row, a structure insert affordance, or the
// canvas relay) into the shared `Menu` with the right items, wired EXCLUSIVELY
// through the controller's copy/cut/paste/duplicate/reorder/remove actions.
//
// ── One menu, two kinds of trigger ──────────────────────────────────────────
// The shared `useMenu` measures a real element. A structure row hands over the
// button that was pressed, and that is the trigger; the canvas hands over a
// rect in host coordinates, because the control that was pressed lives inside
// the preview iframe and this document cannot hold it. For that case the host
// renders one zero-size anchor element (`anchorProps`) which this hook parks at
// the relayed rect before opening — so both origins position and dismiss
// through exactly one implementation.
//
// ── Menu content is DERIVED, not stored ─────────────────────────────────────
// Only WHICH menu is open (node vs insert, its subject, and how to restore
// focus on close) is state. The item list is recomputed from the live
// `controller.state` on every render, so an action elsewhere can never leave a
// menu showing stale affordances for a node that already changed.
//
// ── Two distinct "close" paths ──────────────────────────────────────────────
// `close()` invokes the caller-supplied `restoreFocus` thunk: a structure
// trigger's thunk focuses itself, the canvas relay's round-trips over the
// bridge so the IFRAME restores focus to its own control. "Add component…" is
// the exception — it hands off to the shared chooser, which owns its own focus
// capture, so it closes SILENTLY rather than racing an asynchronous cross-frame
// focus round-trip against the chooser's synchronous `document.activeElement`
// capture.

import { useCallback, useMemo, useRef, useState } from "preact/hooks";
import type { InsertionTarget } from "../../../composer/browser";
import { findLocation, isNodeOpaque } from "../../../composer/browser";
import { useMenu, type MenuController } from "../../../components/overlay";
import { buildCatalogById, summarizeNode } from "../ui/tree/tree-helpers";
import type { ComposerIntegrationApi } from "./use-composer-integration";

/** A `getBoundingClientRect()`-shaped value in HOST viewport coordinates. */
export interface MenuAnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ComposerMenuItemKind = "copy" | "cut" | "duplicate" | "move-up" | "move-down" | "delete" | "add" | "paste";

export interface ComposerMenuItemSpec {
  id: ComposerMenuItemKind;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Renders after a separator, styled destructive. */
  danger?: boolean;
}

interface NodeMenu {
  kind: "node";
  nodeId: string;
  restoreFocus: () => void;
}

interface InsertMenu {
  kind: "insert";
  target: InsertionTarget;
  restoreFocus: () => void;
  /** Defaults to `api.openChooser(target)`; the canvas relay focuses the iframe first. */
  addComponent: () => void;
}

type MenuSubject = NodeMenu | InsertMenu | null;

export interface ComposerMenusApi {
  /** Drives the shared `<Menu>`; the host renders one instance. */
  controller: MenuController;
  /** Accessible name for the current menu. */
  label: string;
  items: readonly ComposerMenuItemSpec[];
  /** Spread onto the host's single zero-size canvas anchor element. */
  anchorRef: (element: HTMLElement | null) => void;
  /** Escape / outside click / an item choosing to dismiss — restores focus, then closes. */
  close: () => void;

  // ── Generic openers (rect + explicit restoreFocus — the canvas relay uses these) ──
  openNodeMenu: (nodeId: string, rect: MenuAnchorRect, restoreFocus: () => void) => void;
  openInsertMenu: (
    target: InsertionTarget,
    rect: MenuAnchorRect,
    restoreFocus: () => void,
    addComponent?: () => void,
  ) => void;

  // ── Structure-row wrappers — the `(id/target, trigger)` callback shape ──
  handleTreeOpenNodeMenu: (nodeId: string, trigger: HTMLElement) => void;
  handleTreeOpenInsertMenu: (target: InsertionTarget, trigger: HTMLElement) => void;
}

export function useComposerMenus(api: ComposerIntegrationApi): ComposerMenusApi {
  const { controller, manifestEntries, titleFor } = api;
  const manifest = controller.manifest;
  const [subject, setSubject] = useState<MenuSubject>(null);

  // The element `useMenu` measures. It is whichever row button was pressed, or
  // the canvas anchor parked at the relayed rect.
  const triggerRef = useRef<HTMLElement | null>(null);
  const canvasAnchor = useRef<HTMLElement | null>(null);
  const menu = useMenu(triggerRef, { align: "start" });
  const { openMenu, closeMenu } = menu;

  const catalogById = useMemo(() => buildCatalogById(manifestEntries), [manifestEntries]);

  const subjectRef = useRef<MenuSubject>(null);
  subjectRef.current = subject;

  /** Clear the menu WITHOUT invoking `restoreFocus` — the "Add component…" hand-off. */
  const closeSilently = useCallback(() => {
    closeMenu({ restoreFocus: false });
    setSubject(null);
  }, [closeMenu]);

  /** The normal close path: restore focus to the originating control, then clear. */
  const close = useCallback(() => {
    closeMenu({ restoreFocus: false });
    subjectRef.current?.restoreFocus();
    setSubject(null);
  }, [closeMenu]);

  const openAt = useCallback(
    (next: NonNullable<MenuSubject>, trigger: HTMLElement | null, rect: MenuAnchorRect | null) => {
      if (trigger) {
        triggerRef.current = trigger;
      } else if (canvasAnchor.current && rect) {
        // Park the anchor before opening: the menu measures it in a layout
        // effect on the very next render, so a later write would be too late.
        const style = canvasAnchor.current.style;
        style.left = `${rect.x}px`;
        style.top = `${rect.y}px`;
        style.width = `${rect.width}px`;
        style.height = `${rect.height}px`;
        triggerRef.current = canvasAnchor.current;
      }
      setSubject(next);
      openMenu("first");
    },
    [openMenu],
  );

  const openNodeMenu = useCallback(
    (nodeId: string, rect: MenuAnchorRect, restoreFocus: () => void) => {
      openAt({ kind: "node", nodeId, restoreFocus }, null, rect);
    },
    [openAt],
  );

  const openInsertMenu = useCallback(
    (target: InsertionTarget, rect: MenuAnchorRect, restoreFocus: () => void, addComponentOverride?: () => void) => {
      openAt(
        {
          kind: "insert",
          target,
          restoreFocus,
          addComponent: addComponentOverride ?? (() => api.openChooser(target)),
        },
        null,
        rect,
      );
    },
    [api, openAt],
  );

  const handleTreeOpenNodeMenu = useCallback(
    (nodeId: string, trigger: HTMLElement) => {
      openAt({ kind: "node", nodeId, restoreFocus: () => trigger.focus() }, trigger, null);
    },
    [openAt],
  );

  const handleTreeOpenInsertMenu = useCallback(
    (target: InsertionTarget, trigger: HTMLElement) => {
      openAt(
        {
          kind: "insert",
          target,
          restoreFocus: () => trigger.focus(),
          addComponent: () => api.openChooser(target),
        },
        trigger,
        null,
      );
    },
    [api, openAt],
  );

  const derived = useMemo((): { label: string; items: readonly ComposerMenuItemSpec[] } => {
    if (subject === null) return { label: "Menu", items: [] };

    if (subject.kind === "node") {
      const location = findLocation(controller.state.document, manifest, subject.nodeId);
      // The node vanished from under an open menu (a rare race) — nothing to
      // show; Escape and outside-click still close it normally.
      if (!location) return { label: "Menu", items: [] };

      const summary = summarizeNode(location.node, manifest, catalogById);
      const displayName = summary.subtitle ? `${summary.title} ${summary.subtitle}` : summary.title;
      const siblings =
        location.parentId === null
          ? controller.state.document.root
          : (findLocation(controller.state.document, manifest, location.parentId)?.node.slots[location.slotId] ?? []);

      const opaque = isNodeOpaque(location.node, manifest);
      const items: ComposerMenuItemSpec[] = [];
      if (!opaque) {
        items.push(
          { id: "copy", label: "Copy", onSelect: () => { controller.copy(subject.nodeId); close(); } },
          { id: "cut", label: "Cut", onSelect: () => { controller.cut(subject.nodeId); close(); } },
          { id: "duplicate", label: "Duplicate", onSelect: () => { controller.duplicate(subject.nodeId); close(); } },
        );
      }
      // Reorder has no row affordance of its own — the structure rows carry Add
      // and More only — so a sibling move lives here, where every other
      // structural action for this node already is.
      items.push(
        {
          id: "move-up",
          label: "Move up",
          disabled: location.index === 0,
          onSelect: () => { controller.reorder(subject.nodeId, "up"); close(); },
        },
        {
          id: "move-down",
          label: "Move down",
          disabled: location.index >= siblings.length - 1,
          onSelect: () => { controller.reorder(subject.nodeId, "down"); close(); },
        },
        {
          id: "delete",
          label: "Delete",
          danger: true,
          onSelect: () => { controller.remove(subject.nodeId); close(); },
        },
      );
      return { label: `${displayName} menu`, items };
    }

    // Insert menu: "Add component…" AND "Paste here" are BOTH always present.
    const clipboard = controller.state.clipboard;
    const clipboardLabel = clipboard ? (titleFor(clipboard.componentId) ?? clipboard.componentId) : null;
    return {
      label: "Insert menu",
      items: [
        {
          id: "add",
          label: "Add component…",
          onSelect: () => {
            const addComponent = subject.addComponent;
            closeSilently();
            addComponent();
          },
        },
        {
          id: "paste",
          label: clipboardLabel ? `Paste "${clipboardLabel}" here` : "Paste here",
          disabled: clipboard === null,
          onSelect: () => { controller.paste(subject.target); close(); },
        },
      ],
    };
  }, [catalogById, close, closeSilently, controller, manifest, subject, titleFor]);

  return {
    controller: menu,
    label: derived.label,
    items: derived.items,
    anchorRef: (element) => { canvasAnchor.current = element; },
    close,
    openNodeMenu,
    openInsertMenu,
    handleTreeOpenNodeMenu,
    handleTreeOpenInsertMenu,
  };
}
