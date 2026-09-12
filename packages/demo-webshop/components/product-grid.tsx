import { defineComponent } from "@zudo-composer/component-contract";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { GridRegistryContext, GridViewContext, useGridRegistry } from "./grid-context";
import { SHOP_SORTS, computeGridView, type ShopSort } from "./grid-view";
import { Pagination } from "./pagination";
import { CAPS, CONTROL } from "./tone";

export interface ProductGridProps {
  toolbar: boolean;
  chips: boolean;
  pageSize: number;
  defaultSort: ShopSort;
  emptyText: string;
  items?: ComponentChildren;
}

const SORT_LABEL: Record<ShopSort, string> = {
  featured: "Featured",
  "price-asc": "Price, low to high",
  "price-desc": "Price, high to low",
  name: "Name",
};

const SEARCH_DEBOUNCE_MS = 150;

interface ToolbarState {
  categories: string[];
  sort: ShopSort;
  search: string;
  page: number;
}

function readQuery(defaultSort: ShopSort): ToolbarState {
  const params = new URLSearchParams(location.search);
  const sort = params.get("sort") as ShopSort | null;
  return {
    categories: (params.get("cat") ?? "").split(",").filter((category) => category !== ""),
    sort: sort && SHOP_SORTS.includes(sort) ? sort : defaultSort,
    search: params.get("q") ?? "",
    page: Number(params.get("page")) || 1,
  };
}

function writeQuery(state: ToolbarState, defaultSort: ShopSort): void {
  const params = new URLSearchParams(location.search);
  const set = (key: string, value: string) => (value === "" ? params.delete(key) : params.set(key, value));
  set("cat", state.categories.join(","));
  set("sort", state.sort === defaultSort ? "" : state.sort);
  set("q", state.search);
  set("page", state.page > 1 ? String(state.page) : "");
  const query = params.toString();
  history.replaceState(history.state, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
}

function label(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function ProductGrid({ toolbar = true, chips = true, pageSize = 8, defaultSort = "featured", emptyText = "No products match.", items }: ProductGridProps) {
  const { registry, ordered } = useGridRegistry();
  const [state, setState] = useState<ToolbarState>({ categories: [], sort: defaultSort, search: "", page: 1 });
  const [searchInput, setSearchInput] = useState("");
  const [urlReady, setUrlReady] = useState(false);

  useEffect(() => {
    if (!toolbar) return;
    const initial = readQuery(defaultSort);
    setState(initial);
    setSearchInput(initial.search);
    setUrlReady(true);
  }, [toolbar, defaultSort]);

  useEffect(() => {
    if (urlReady) writeQuery(state, defaultSort);
  }, [urlReady, state, defaultSort]);

  useEffect(() => {
    if (searchInput === state.search) return;
    const timer = setTimeout(() => setState((previous) => ({ ...previous, search: searchInput, page: 1 })), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, state.search]);

  const view = computeGridView(ordered, {
    categories: toolbar && chips ? state.categories : [],
    sort: toolbar ? state.sort : defaultSort,
    search: toolbar ? state.search : "",
    page: state.page,
    pageSize: toolbar ? pageSize : 0,
  });

  const toggleCategory = (category: string) =>
    setState((previous) => ({
      ...previous,
      page: 1,
      categories: previous.categories.includes(category) ? previous.categories.filter((item) => item !== category) : [...previous.categories, category],
    }));

  return (
    <GridRegistryContext.Provider value={registry}>
      <GridViewContext.Provider value={view.items}>
        <div class="flex flex-col gap-shop-vsp-md">
          {toolbar && (
            <div class="flex flex-col gap-shop-vsp-sm border-b border-shop-border pb-shop-vsp-sm shop-md:flex-row shop-md:items-center shop-md:justify-between">
              <p class={`${CAPS} text-shop-muted`} aria-live="polite">
                {view.matchCount} {view.matchCount === 1 ? "product" : "products"}
              </p>
              <div class="flex flex-wrap items-center gap-shop-hsp-xs">
                {chips && view.categories.map((category) => {
                  const active = state.categories.includes(category);
                  return (
                    <button
                      key={category}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleCategory(category)}
                      class={`h-shop-control-h px-shop-hsp-sm border text-shop-body hover:bg-shop-inverse-bg hover:text-shop-inverse-fg ${active ? "border-shop-fg-strong bg-shop-surface-2 text-shop-fg-strong" : "border-shop-border text-shop-fg"}`}
                    >
                      {label(category)}
                    </button>
                  );
                })}
                <label class="flex items-center gap-shop-hsp-xs text-shop-caption text-shop-muted">
                  <span class="uppercase tracking-shop-caps">Sort</span>
                  <select
                    value={state.sort}
                    onChange={(event) => setState((previous) => ({ ...previous, page: 1, sort: event.currentTarget.value as ShopSort }))}
                    // A non-default sort earns the accent underline (§ 3 accent uses).
                    class={`${CONTROL} ${state.sort === defaultSort ? "" : "border-b-2 border-b-shop-accent"}`}
                  >
                    {SHOP_SORTS.map((sort) => <option key={sort} value={sort}>{SORT_LABEL[sort]}</option>)}
                  </select>
                </label>
                <input
                  type="search"
                  aria-label="Search products"
                  placeholder="Search"
                  value={searchInput}
                  onInput={(event) => setSearchInput(event.currentTarget.value)}
                  class={CONTROL}
                />
              </div>
            </div>
          )}
          <div class="grid grid-cols-1 gap-x-shop-hsp-md gap-y-shop-vsp-lg shop-sm:grid-cols-2 shop-lg:grid-cols-3 shop-lg:gap-x-shop-hsp-lg shop-xl:grid-cols-4">{items}</div>
          {ordered.length > 0 && view.matchCount === 0 && <p class="text-shop-body text-shop-muted">{emptyText}</p>}
          {toolbar && view.pageCount > 1 && (
            <Pagination page={view.page} pageCount={view.pageCount} onPage={(page) => setState((previous) => ({ ...previous, page }))} />
          )}
        </div>
      </GridViewContext.Provider>
    </GridRegistryContext.Provider>
  );
}

export const productGridComponent = defineComponent<ProductGridProps>()(ProductGrid, {
  id: "shop.product-grid",
  schemaVersion: 1,
  title: "Product grid",
  category: "Catalog",
  description: "List host for product cards with category chips, sort, search and pagination.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "ProductGrid" },
  defaults: { toolbar: true, chips: true, pageSize: 8, defaultSort: "featured", emptyText: "No products match." },
  fields: [
    { kind: "boolean", prop: "toolbar", label: "Toolbar" },
    { kind: "boolean", prop: "chips", label: "Category chips" },
    { kind: "number", prop: "pageSize", label: "Page size", min: 4, max: 24, step: 4 },
    { kind: "select", prop: "defaultSort", label: "Default sort", options: ["featured", "price-asc", "price-desc", "name"] },
    { kind: "text", prop: "emptyText", label: "Empty text" },
  ],
  slots: [{ id: "items", prop: "items", label: "Products", cardinality: "many", accepts: ["shop.product-card"] }],
});
