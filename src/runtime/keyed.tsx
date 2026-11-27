import { computed, For, type Child, type Key, type ReadonlySignal } from "@takazudo/zfb/zudo-react";

export interface KeyedProps<T> {
  value: ReadonlySignal<T>;
  by: (value: T) => Key;
  children: (value: ReadonlySignal<T>) => Child;
}

/**
 * Replacement for a Preact `key={k}` remount: one keyed `For` item. A key
 * change disposes the old subtree (cleanups, abort) and runs a fresh setup.
 * The preview renderer keys each composition node by `(nodeId, propsRevision)`
 * so plain-value pack components remount on a prop change (see `nodeRenderKey`).
 */
export function Keyed<T>(props: KeyedProps<T>): Child {
  const items = computed(() => [props.value.value] as const);
  return <For each={items} by={props.by}>{(item) => props.children(item)}</For>;
}

/** The remount key for one rendered composition node: its id plus the revision of its props. */
export function nodeRenderKey(nodeId: string, propsRevision: number): string {
  return `${nodeId}@${propsRevision}`;
}
