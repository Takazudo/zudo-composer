import { computed, getScope, Show, signal, type Ref, type Signal } from "@takazudo/zfb/zudo-react";
import { Rebuild } from "../../components/rebuild";
import { read, type MaybeSignal } from "../../components/reactive";
import { watch } from "../native-editing/live";
import { projectHostTree } from "./tree-presentation";
import type { HostDocumentTarget } from "../../../server/host-document/types";

export function componentTitle(target: HostDocumentTarget, titles: ReadonlyMap<string, string>): string {
  return target.presentation?.label ?? titles.get(target.componentId) ?? target.componentId.replace(/[-_.]/g, " ");
}

type Hierarchy = ReturnType<typeof projectHostTree>;
interface TreeState {
  hierarchy: Hierarchy; titles: ReadonlyMap<string, string>; selectedId: MaybeSignal<string | undefined>; disabled: MaybeSignal<boolean>;
  expanded: Signal<ReadonlySet<string>>; focusedId: Signal<string | null>;
  elements: Map<string, Ref<HTMLLIElement>>; onSelect(target: HostDocumentTarget): void;
}

/** Arrangement follows rendered parents; selection always retains the exact owning target. */
export function HostComponentTree({ targets, titles, selectedId, disabled, onSelect }: {
  targets: readonly HostDocumentTarget[]; titles: ReadonlyMap<string, string>; selectedId?: MaybeSignal<string | undefined>;
  disabled: MaybeSignal<boolean>; onSelect(target: HostDocumentTarget): void;
}) {
  const scope = getScope();
  const selected = computed(() => read(selectedId));
  const showWrappers = signal(false);
  const revealedWrapper = computed(() => targets.find(target => target.renderedNodeId === selected.value)?.presentation?.transparent ? selected.value : undefined);
  const hierarchy = computed(() => projectHostTree(targets, showWrappers.value, revealedWrapper.value));
  const expanded = signal<ReadonlySet<string>>(new Set());
  const focusedId = signal<string | null>(null);
  const elements = new Map<string, Ref<HTMLLIElement>>();
  watch(scope, () => [hierarchy.value] as const, ([value]) => {
    expanded.value = new Set(value.roots.map(target => target.renderedNodeId));
    focusedId.value = value.roots[0]?.renderedNodeId ?? null;
  });
  watch(scope, () => [selected.value, hierarchy.value] as const, ([id, value]) => {
    if (!id || !value.byId.has(id)) return;
    const ancestors = new Set<string>();
    let parent = value.parentOf.get(id);
    while (parent && !ancestors.has(parent)) { ancestors.add(parent); parent = value.parentOf.get(parent); }
    expanded.value = new Set([...expanded.value, ...ancestors]);
    focusedId.value = id;
  });
  watch(scope, () => [selected.value, expanded.value] as const, ([id]) => { if (id) elements.get(id)?.current?.scrollIntoView?.({ block: "nearest" }); });
  return <><label class="cms-host-tree-options"><input type="checkbox" modelChecked={showWrappers} /> Show structural wrappers</label><Rebuild value={hierarchy}>{value => {
    const state: TreeState = { hierarchy: value, titles, selectedId: selected, disabled, expanded, focusedId, elements, onSelect };
    return <ul class="cms-host-tree" role="tree" aria-label="Page components">{rows(state, value.roots, 1)}</ul>;
  }}</Rebuild></>;
}

const rows = (state: TreeState, nodes: readonly HostDocumentTarget[], level: number) => nodes.map((target, index) => <TreeRow state={state} target={target} level={level} index={index} size={nodes.length} />);

function TreeRow({ state, target, level, index, size }: { state: TreeState; target: HostDocumentTarget; level: number; index: number; size: number }) {
  const { hierarchy, expanded, focusedId, elements } = state;
  const id = target.renderedNodeId, children = hierarchy.children.get(id) ?? [], title = componentTitle(target, state.titles);
  const element: Ref<HTMLLIElement> = { current: null };
  elements.set(id, element);
  getScope().onCleanup(() => { if (elements.get(id) === element) elements.delete(id); });
  const open = computed(() => expanded.value.has(id));
  const visible = () => {
    const list: HostDocumentTarget[] = [];
    const collect = (items: readonly HostDocumentTarget[]) => { for (const node of items) { list.push(node); if (expanded.value.has(node.renderedNodeId)) collect(hierarchy.children.get(node.renderedNodeId) ?? []); } };
    collect(hierarchy.roots);
    return list;
  };
  const focus = (next: string | undefined) => { if (next) { focusedId.value = next; elements.get(next)?.current?.focus(); } };
  const toggle = (value: boolean) => { const next = new Set(expanded.value); if (value) next.add(id); else next.delete(id); expanded.value = next; };
  return <li ref={element} role="treeitem" aria-label={title} aria-level={level} aria-posinset={index + 1} aria-setsize={size} aria-selected={computed(() => id === read(state.selectedId))} aria-expanded={children.length ? computed(() => open.value) : undefined} aria-disabled={computed(() => read(state.disabled))} tabindex={computed(() => focusedId.value === id ? 0 : -1)}
    on:focus={event => { if (event.target === event.currentTarget) focusedId.value = id; }}
    on:keydown={event => {
      if (event.target !== event.currentTarget) return;
      const list = visible();
      const position = list.findIndex(node => node.renderedNodeId === id);
      if (["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End", "Enter", " "].includes(event.key)) event.preventDefault();
      if (event.key === "ArrowDown") focus(list[position + 1]?.renderedNodeId);
      if (event.key === "ArrowUp") focus(list[position - 1]?.renderedNodeId);
      if (event.key === "Home") focus(list[0]?.renderedNodeId);
      if (event.key === "End") focus(list.at(-1)?.renderedNodeId);
      if (event.key === "ArrowRight" && children.length) { if (!open.value) toggle(true); else focus(children[0]?.renderedNodeId); }
      if (event.key === "ArrowLeft") { if (children.length && open.value) toggle(false); else focus(hierarchy.parentOf.get(id) ?? undefined); }
      if (!read(state.disabled) && (event.key === "Enter" || event.key === " ")) state.onSelect(target);
    }}>
    <div class="cms-host-tree-row" on:click={() => { focus(id); if (!read(state.disabled)) state.onSelect(target); }}>
      {children.length ? <button type="button" tabindex={-1} aria-label={computed(() => `${open.value ? "Collapse" : "Expand"} ${title}`)} on:click={event => { event.stopPropagation(); focus(id); toggle(!open.value); }}>{computed(() => open.value ? "▾" : "▸")}</button> : <span class="cms-host-tree-leaf" aria-hidden="true" />}
      <span><span>{title}</span>{target.presentation && target.presentation.kindTitle !== title && <small>{target.presentation.kindTitle}</small>}{target.slotId && <small>Slot: {target.slotId}</small>}{target.entries.length > 0 && <small>Shared Content</small>}</span>
    </div>
    {children.length > 0 && <Show when={open}>{() => <ul role="group">{rows(state, children, level + 1)}</ul>}</Show>}
  </li>;
}
