export type ShopSort = "featured" | "price-asc" | "price-desc" | "name";

export const SHOP_SORTS: readonly ShopSort[] = ["featured", "price-asc", "price-desc", "name"];

export interface GridItemData {
  readonly slug: string;
  readonly name: string;
  readonly price: number;
  readonly category: string;
  readonly featured: boolean;
  readonly tags: readonly string[];
}

export interface GridQuery {
  readonly categories: readonly string[];
  readonly sort: ShopSort;
  readonly search: string;
  readonly page: number;
  readonly pageSize: number;
}

export interface GridItemView {
  readonly hidden: boolean;
  readonly order: number;
}

export interface GridView {
  readonly items: ReadonlyMap<string, GridItemView>;
  readonly matchCount: number;
  readonly page: number;
  readonly pageCount: number;
  readonly categories: readonly string[];
}

function compare(sort: ShopSort, a: GridItemData, b: GridItemData): number {
  switch (sort) {
    case "featured":
      return Number(b.featured) - Number(a.featured);
    case "price-asc":
      return a.price - b.price;
    case "price-desc":
      return b.price - a.price;
    case "name":
      return a.name.localeCompare(b.name);
  }
}

/**
 * Items arrive in DOM order (the Mapping query's order). The DOM is never
 * reordered: each item gets `order` for its sorted position and `hidden` when
 * it is filtered out or on another page.
 */
export function computeGridView(items: readonly (readonly [string, GridItemData])[], query: GridQuery): GridView {
  const search = query.search.trim().toLowerCase();
  const matches = items
    .map(([id, data], index) => ({ id, data, index }))
    .filter(({ data }) => query.categories.length === 0 || query.categories.includes(data.category))
    .filter(({ data }) => search === "" || [data.name, ...data.tags].some((text) => text.toLowerCase().includes(search)))
    .sort((a, b) => compare(query.sort, a.data, b.data) || a.index - b.index);
  const pageSize = query.pageSize > 0 ? query.pageSize : Math.max(1, matches.length);
  const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
  const page = Math.min(Math.max(1, Math.floor(query.page) || 1), pageCount);
  const start = (page - 1) * pageSize;
  const views = new Map<string, GridItemView>(items.map(([id]) => [id, { hidden: true, order: 0 }]));
  matches.forEach(({ id }, position) => views.set(id, { hidden: position < start || position >= start + pageSize, order: position }));
  const categories = [...new Set(items.map(([, data]) => data.category).filter((category) => category !== ""))];
  return { items: views, matchCount: matches.length, page, pageCount, categories };
}

/**
 * Related strip: natural (query) order, the current product hidden, and at
 * most `limit` of the rest visible.
 */
export function computeRelatedView(items: readonly (readonly [string, GridItemData])[], currentSlug: string, limit: number): ReadonlyMap<string, GridItemView> {
  const views = new Map<string, GridItemView>();
  let shown = 0;
  items.forEach(([id, data], order) => {
    const visible = (currentSlug === "" || data.slug !== currentSlug) && shown < limit;
    if (visible) shown += 1;
    views.set(id, { hidden: !visible, order });
  });
  return views;
}
