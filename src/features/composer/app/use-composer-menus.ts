"use client";

// The Composer's context-menu orchestration — the ONE place that turns a
// "⋯" activation (from a structure row, a structure insert affordance, or the
// canvas relay) into the shared `Menu` with the right items, wired EXCLUSIVELY
// through the controller's copy/cut/paste/duplicate/reorder/remove actions.
//
// ── One menu, two kinds of trigger ──────────────────────────────────────────
// The shared `createMenu` measures a real element. A structure row hands over the
// button that was pressed, and that is the trigger; the canvas hands over a
// rect in host coordinates, because the control that was pressed lives inside
// the preview iframe and this document cannot hold it. For that case the host
// renders one zero-size anchor element (`anchorRef`) which this controller parks at
// the relayed rect before opening — so both origins position and dismiss
// through exactly one implementation.
//
// ── Menu content is DERIVED, not stored ─────────────────────────────────────
// Only WHICH menu is open (node vs insert, its subject, and how to restore
// focus on close) is state. The item list is derived from the live
// `controller.state` signal, so an action elsewhere can never leave a
// menu showing stale affordances for a node that already changed.
//
// ── Two distinct "close" paths ──────────────────────────────────────────────
// Every close runs the subject's `restoreFocus` thunk: a structure trigger's
// thunk focuses itself, the canvas relay's round-trips over the bridge so the
// IFRAME restores focus to its own control. "Add component…" is the exception —
// it hands off to the shared chooser, which owns its own focus capture, so it
// closes SILENTLY rather than racing an asynchronous cross-frame focus round
// trip against the chooser's synchronous `document.activeElement` capture.
// The quick-insert popover's "Pattern…" and "More…" hand off the same way.
//
// ── Quick insert (issue #639) ───────────────────────────────────────────────
// A canvas add into a restricted slot with few allowed kinds opens a third
// subject whose content is the `QuickInsertPopover`, not an item list. Its
// rule is derived from live state like every other menu's items.

import { computed, signal, type ReadonlySignal, type Ref, type Scope } from "@takazudo/zfb/zudo-react";
import type { InsertionTarget } from "../../../composer/browser";
import { findLocation, isNodeOpaque } from "../../../composer/browser";
import { createMenu, type MenuController } from "../../../components/overlay";
import { buildCatalogById, summarizeNode } from "../ui/tree/tree-helpers";
import { describeSlotRule, type SlotRule } from "../ui/slot-rules";
import { offersQuickInsert, quickInsertSlotLabel } from "../ui/quick-insert/quick-insert-popover";
import type { ChooserTab } from "../ui/chooser/composer-chooser";
import type { CanvasQuickInsertRequest } from "./composer-canvas-host";
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

interface QuickInsertMenu {
  kind: "quick-insert";
  target: InsertionTarget;
  restoreFocus: () => void;
  openChooser: (initialTab?: ChooserTab) => void;
}

type MenuSubject = NodeMenu | InsertMenu | QuickInsertMenu | null;

/** What the host renders inside the shared `Menu` while a quick insert is open. */
export interface QuickInsertView {
  rule: SlotRule;
  onInsert: (componentId: string) => void;
  onOpenPatterns: () => void;
  onOpenChooser: () => void;
}

export interface ComposerMenusApi {
  /** Drives the shared `<Menu>`; the host renders one instance. */
  controller: MenuController;
  /** Accessible name for the current menu. */
  label: ReadonlySignal<string>;
  items: ReadonlySignal<readonly ComposerMenuItemSpec[]>;
  /** Set instead of `items` while the quick-insert popover is the open subject. */
  quickInsert: ReadonlySignal<QuickInsertView | null>;
  /** Changes with the subject kind, so a hand-off from one menu to another remounts and refocuses the panel. */
  menuKey: ReadonlySignal<string>;
  /** The `ref` of the host's single zero-size canvas anchor element. */
  anchorRef: Ref<HTMLElement>;
  /** Dismiss from an item. Every close restores focus to whatever opened it. */
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
  handleTreeOpenInsertMenu: (target: InsertionTarget, trigger: HTMLElement, addComponent?: () => void) => void;

  /** Canvas add: opens the quick-insert popover and returns true when the target's rule qualifies. */
  requestQuickInsert: (request: CanvasQuickInsertRequest) => boolean;
}

export function createComposerMenus(scope: Scope, api: ComposerIntegrationApi): ComposerMenusApi {
  const { controller, manifestEntries, titleFor } = api;
  const manifest = controller.manifest;
  const subject = signal<MenuSubject>(null);

  // The element the menu measures. It is whichever row button was pressed, or
  // the canvas anchor parked at the relayed rect.
  const triggerRef: Ref<HTMLElement> = { current: null };
  const canvasAnchor: Ref<HTMLElement> = { current: null };
  /** Set only for the "Add component…" hand-off, which owns the focus itself. */
  let skipRestore = false;

  // Focus restoration hangs off the CLOSE, not off the caller, because the
  // shared menu also closes itself — Escape, an outside pointer, a scroll. The
  // canvas origin is why that matters: its control lives in the iframe, and a
  // dismissal that skipped the round trip would strand focus in the host.
  const menu = createMenu(triggerRef, {
    align: "start",
    onOpenChange: (open) => {
      if (open) return;
      const closing = subject.value;
      subject.value = null;
      if (skipRestore) {
        skipRestore = false;
        return;
      }
      closing?.restoreFocus();
    },
  });
  const { openMenu, closeMenu } = menu;
  scope.onCleanup(() => {
    subject.value = null;
  });

  const catalogById = buildCatalogById(manifestEntries);

  /** Clear the menu WITHOUT invoking `restoreFocus` — the "Add component…" hand-off. */
  const closeSilently = () => {
    skipRestore = true;
    closeMenu({ restoreFocus: false });
  };

  /** The normal close path: the open-change handler restores focus and clears. */
  const close = () => {
    closeMenu({ restoreFocus: false });
  };

  const openAt = (next: NonNullable<MenuSubject>, trigger: HTMLElement | null, rect: MenuAnchorRect | null) => {
    if (trigger) {
      triggerRef.current = trigger;
    } else if (canvasAnchor.current && rect) {
      // Park the anchor before opening: the menu measures it as it opens, so a
      // later write would be too late.
      const style = canvasAnchor.current.style;
      style.left = `${rect.x}px`;
      style.top = `${rect.y}px`;
      style.width = `${rect.width}px`;
      style.height = `${rect.height}px`;
      triggerRef.current = canvasAnchor.current;
    }
    subject.value = next;
    openMenu("first");
  };

  const openNodeMenu = (nodeId: string, rect: MenuAnchorRect, restoreFocus: () => void) => {
    openAt({ kind: "node", nodeId, restoreFocus }, null, rect);
  };

  const openInsertMenu = (target: InsertionTarget, rect: MenuAnchorRect, restoreFocus: () => void, addComponentOverride?: () => void) => {
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
  };

  const handleTreeOpenNodeMenu = (nodeId: string, trigger: HTMLElement) => {
    openAt({ kind: "node", nodeId, restoreFocus: () => trigger.focus() }, trigger, null);
  };

  const handleTreeOpenInsertMenu = (target: InsertionTarget, trigger: HTMLElement, addComponentOverride?: () => void) => {
    openAt(
      {
        kind: "insert",
        target,
        restoreFocus: () => trigger.focus(),
        addComponent: addComponentOverride ?? (() => api.openChooser(target)),
      },
      trigger,
      null,
    );
  };

  const ruleFor = (target: InsertionTarget): SlotRule =>
    describeSlotRule({
      catalog: manifestEntries,
      manifest,
      document: controller.state.value.document,
      target,
      rootPolicy: controller.state.value.rootPolicy,
    });

  const requestQuickInsert = ({ target, rect, restoreFocus, openChooser }: CanvasQuickInsertRequest): boolean => {
    if (controller.state.value.mode !== "edit" || !offersQuickInsert(ruleFor(target))) return false;
    openAt({ kind: "quick-insert", target, restoreFocus, openChooser }, null, rect);
    return true;
  };

  const quickInsert = computed((): QuickInsertView | null => {
    const current = subject.value;
    if (current?.kind !== "quick-insert") return null;
    const handOff = (initialTab?: ChooserTab) => {
      closeSilently();
      current.openChooser(initialTab);
    };
    return {
      rule: ruleFor(current.target),
      onInsert: (componentId) => {
        const result = api.handleChooserAdd(current.target, componentId);
        if (result.status === "inserted") api.revealNode(result.nodeId);
        close();
      },
      onOpenPatterns: () => handOff("patterns"),
      onOpenChooser: () => handOff(),
    };
  });

  const derived = computed((): { label: string; items: readonly ComposerMenuItemSpec[] } => {
    const current = subject.value;
    if (current === null) return { label: "Menu", items: [] };
    const state = controller.state.value;
    if (current.kind === "quick-insert") {
      return { label: `${quickInsertSlotLabel(ruleFor(current.target))} accepts`, items: [] };
    }

    if (current.kind === "node") {
      const location = findLocation(state.document, manifest, current.nodeId);
      // The node vanished from under an open menu (a rare race) — nothing to
      // show; Escape and outside-click still close it normally.
      if (!location) return { label: "Menu", items: [] };

      const summary = summarizeNode(location.node, manifest, catalogById);
      const displayName = summary.subtitle ? `${summary.title} ${summary.subtitle}` : summary.title;
      const siblings =
        location.parentId === null
          ? state.document.root
          : (findLocation(state.document, manifest, location.parentId)?.node.slots[location.slotId] ?? []);

      const opaque = isNodeOpaque(location.node, manifest);
      const items: ComposerMenuItemSpec[] = [];
      if (!opaque) {
        items.push(
          { id: "copy", label: "Copy", onSelect: () => { controller.copy(current.nodeId); close(); } },
          { id: "cut", label: "Cut", onSelect: () => { controller.cut(current.nodeId); close(); } },
          { id: "duplicate", label: "Duplicate", onSelect: () => { controller.duplicate(current.nodeId); close(); } },
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
          onSelect: () => { controller.reorder(current.nodeId, "up"); close(); },
        },
        {
          id: "move-down",
          label: "Move down",
          disabled: location.index >= siblings.length - 1,
          onSelect: () => { controller.reorder(current.nodeId, "down"); close(); },
        },
        {
          id: "delete",
          label: "Delete",
          danger: true,
          onSelect: () => { controller.remove(current.nodeId); close(); },
        },
      );
      return { label: `${displayName} menu`, items };
    }

    // Insert menu: "Add component…" AND "Paste here" are BOTH always present.
    const clipboard = state.clipboard;
    const clipboardLabel = clipboard ? (titleFor(clipboard.componentId) ?? clipboard.componentId) : null;
    return {
      label: "Insert menu",
      items: [
        {
          id: "add",
          label: "Add component…",
          onSelect: () => {
            const addComponent = current.addComponent;
            closeSilently();
            addComponent();
          },
        },
        {
          id: "paste",
          label: clipboardLabel ? `Paste "${clipboardLabel}" here` : "Paste here",
          disabled: clipboard === null,
          onSelect: () => { controller.paste(current.target); close(); },
        },
      ],
    };
  });

  return {
    controller: menu,
    label: computed(() => derived.value.label),
    items: computed(() => derived.value.items),
    quickInsert,
    menuKey: computed(() => subject.value?.kind ?? "closed"),
    anchorRef: canvasAnchor,
    close,
    openNodeMenu,
    openInsertMenu,
    handleTreeOpenNodeMenu,
    handleTreeOpenInsertMenu,
    requestQuickInsert,
  };
}
