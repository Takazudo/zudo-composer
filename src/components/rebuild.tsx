import { computed, type Child, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { Keyed } from "../runtime";

export interface RebuildProps<T> {
  value: ReadonlySignal<T>;
  /** Runs once per distinct value; the previous subtree is disposed first. */
  children: (value: T) => Child;
}

/**
 * Remounts `children` whenever `value` changes identity. For read-only views
 * whose whole shape follows one snapshot (a summary, a status card); a surface
 * with inputs or focus that must survive an update binds signals instead.
 */
export function Rebuild<T>(props: RebuildProps<T>): Child {
  let revision = 0;
  let last: { value: T } | null = null;
  const keyed = computed(() => {
    const value = props.value.value;
    if (last === null || !Object.is(last.value, value)) {
      revision += 1;
      last = { value };
    }
    return { revision, value };
  });
  return <Keyed value={keyed} by={(entry) => entry.revision}>{(entry) => props.children(entry.value.value)}</Keyed>;
}

/** A slot whose content may follow caller state: a static child or a signal of one. */
export type LiveChild = Child | ReadonlySignal<Child>;

function isLiveSignal(slot: LiveChild): slot is ReadonlySignal<Child> {
  return typeof slot === "object" && slot !== null && !Array.isArray(slot) && "$$zudoReactive" in slot;
}

function hasContent(child: Child): boolean {
  return child !== undefined && child !== null && child !== false && child !== "";
}

/**
 * Renders `slot`, wrapped by `wrap` only while it has content. A signal slot
 * rebuilds on each change, so a wrapper never shows around nothing.
 */
export function liveSlot(slot: LiveChild | undefined, wrap: (content: Child) => Child = (content) => content): Child {
  if (slot === undefined) return null;
  if (!isLiveSignal(slot)) return hasContent(slot) ? wrap(slot) : null;
  return <Rebuild value={slot}>{(content) => (hasContent(content) ? wrap(content) : null)}</Rebuild>;
}
