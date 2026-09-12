import { createContext } from "preact";
import { useContext, useId, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { GridItemData, GridItemView } from "./grid-view";

export interface GridRegistry<T = GridItemData> {
  register(id: string, data: T): void;
  unregister(id: string): void;
}

// Two contexts: the registry never changes identity, so an item re-registering
// cannot re-render the grid into a new registry and loop.
export const GridRegistryContext = createContext<GridRegistry | null>(null);
export const GridViewContext = createContext<ReadonlyMap<string, GridItemView> | null>(null);

const NATURAL: GridItemView = { hidden: false, order: 0 };

/** Without a grid provider (Composer canvas, static authoring) an item is visible in natural order. */
export function useGridItem(data: GridItemData): GridItemView & { managed: boolean } {
  const registry = useContext(GridRegistryContext);
  const views = useContext(GridViewContext);
  const id = useId();
  const tagsKey = data.tags.join("\n");
  useLayoutEffect(() => {
    registry?.register(id, data);
    // `data` is a fresh object each render; its primitives are the real dependencies.
  }, [registry, id, data.slug, data.name, data.price, data.category, data.featured, tagsKey]);
  useLayoutEffect(() => () => registry?.unregister(id), [registry, id]);
  const view = views?.get(id);
  return view ? { ...view, managed: true } : { ...NATURAL, managed: false };
}

/** The list host's side: items register themselves; `ordered` is first-registration (= DOM = Mapping query) order. */
export function useGridRegistry<T = GridItemData>() {
  const [items, setItems] = useState<ReadonlyMap<string, T>>(new Map());
  const sequence = useRef(new Map<string, number>());
  const registry = useMemo<GridRegistry<T>>(() => ({
    register(id, data) {
      if (!sequence.current.has(id)) sequence.current.set(id, sequence.current.size === 0 ? 0 : Math.max(...sequence.current.values()) + 1);
      setItems((previous) => new Map(previous).set(id, data));
    },
    unregister(id) {
      sequence.current.delete(id);
      setItems((previous) => {
        const next = new Map(previous);
        next.delete(id);
        return next;
      });
    },
  }), []);
  const ordered = [...items].sort(([a], [b]) => (sequence.current.get(a) ?? 0) - (sequence.current.get(b) ?? 0));
  return { registry, ordered };
}
