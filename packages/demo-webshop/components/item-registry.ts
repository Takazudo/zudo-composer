import { computed, getScope, signal, type ReadonlySignal, type Ref } from "@takazudo/zfb/zudo-react";
import { requestLink, type SlotLink } from "./slot-link";

export interface RegisteredItem<V> {
  /** Undefined until the host has a view for this item. */
  readonly view: ReadonlySignal<V | undefined>;
  release(): void;
}

/** What a slot child receives from its list host through a `SlotLink`. */
export interface ItemHost<T, V> {
  register(data: T, element: Element): RegisteredItem<V>;
}

interface Entry<T> {
  readonly id: string;
  readonly data: T;
  readonly element: Element;
}

function documentOrder<T>(a: Entry<T>, b: Entry<T>): number {
  if (a.element === b.element) return 0;
  return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

/**
 * The list host's side: items register themselves with their element, and
 * `ordered` is DOM order (= the Mapping query's order). `views` is read lazily,
 * so it may close over state the host derives from `ordered`.
 */
export interface ItemRegistry<T, V> {
  readonly ordered: ReadonlySignal<readonly (readonly [string, T])[]>;
  readonly host: ItemHost<T, V>;
}

export function createItemRegistry<T, V>(views: () => ReadonlyMap<string, V>): ItemRegistry<T, V> {
  const entries = signal<readonly Entry<T>[]>([]);
  let sequence = 0;
  const ordered = computed(() => entries.value.map((entry) => [entry.id, entry.data] as const));
  const host: ItemHost<T, V> = {
    register(data, element) {
      const id = `item-${sequence++}`;
      entries.value = [...entries.value, { id, data, element }].sort(documentOrder);
      return {
        view: computed(() => views().get(id)),
        release() {
          entries.value = entries.value.filter((entry) => entry.id !== id);
        },
      };
    },
  };
  return { ordered, host };
}

/** The item's side: registers with the nearest `link` host on activation; the view stays undefined without one. */
export function linkItem<T, V>(link: SlotLink<ItemHost<T, V>>, data: T, element: Ref<Element>): ReadonlySignal<V | undefined> {
  const membership = signal<RegisteredItem<V> | null>(null);
  getScope().onActivate(() => {
    const target = element.current;
    const host = requestLink(link, target);
    if (!host || !target) return;
    const item = host.register(data, target);
    membership.value = item;
    return () => item.release();
  });
  return computed(() => membership.value?.view.value);
}
