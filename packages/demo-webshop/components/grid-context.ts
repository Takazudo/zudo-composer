import { createContext } from "preact";
import { useContext, useId, useLayoutEffect } from "preact/hooks";
import type { GridItemData, GridItemView } from "./grid-view";

export interface GridRegistry {
  register(id: string, data: GridItemData): void;
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
  }, [registry, id, data.name, data.price, data.category, data.featured, tagsKey]);
  useLayoutEffect(() => () => registry?.unregister(id), [registry, id]);
  const view = views?.get(id);
  return view ? { ...view, managed: true } : { ...NATURAL, managed: false };
}
