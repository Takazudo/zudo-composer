import { defineComponent } from "@zudo-composer/component-contract";
import { For, Show, batch, computed, getScope, signal, type Child, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { GRID_ITEM_LINK } from "./grid-link";
import { SHOP_SORTS, computeGridView, type GridItemData, type GridItemView, type GridView, type ShopSort } from "./grid-view";
import { createItemRegistry } from "./item-registry";
import { PaginationControls } from "./pagination";
import { answerLink } from "./slot-link";
import { CAPS, CONTROL } from "./tone";

export interface ProductGridProps {
  toolbar: boolean;
  chips: boolean;
  pageSize: number;
  defaultSort: ShopSort;
  emptyText: string;
  items?: Child | object;
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
  const scope = getScope();
  const categories = signal<readonly string[]>([]);
  const sort = signal<string>(defaultSort);
  const search = signal("");
  const page = signal(1);
  const searchInput = signal("");
  const urlReady = signal(false);
  const activeSort = computed(() => (SHOP_SORTS.includes(sort.value as ShopSort) ? (sort.value as ShopSort) : defaultSort));

  const { ordered, host } = createItemRegistry<GridItemData, GridItemView>(() => view.value.items);
  const view: ReadonlySignal<GridView> = computed(() =>
    computeGridView(ordered.value, {
      categories: toolbar && chips ? categories.value : [],
      sort: toolbar ? activeSort.value : defaultSort,
      search: toolbar ? search.value : "",
      page: page.value,
      pageSize: toolbar ? pageSize : 0,
    }),
  );

  scope.onActivate(() => {
    if (!toolbar) return;
    const initial = readQuery(defaultSort);
    batch(() => {
      categories.value = initial.categories;
      sort.value = initial.sort;
      search.value = initial.search;
      page.value = initial.page;
      searchInput.value = initial.search;
      urlReady.value = true;
    });
  });

  scope.effect(() => {
    if (urlReady.value) writeQuery({ categories: [...categories.value], sort: activeSort.value, search: search.value, page: page.value }, defaultSort);
  });

  scope.effect(() => {
    const next = searchInput.value;
    if (next === search.value) return;
    const timer = setTimeout(() => batch(() => {
      search.value = next;
      page.value = 1;
    }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  const toggleCategory = (category: string) =>
    batch(() => {
      page.value = 1;
      categories.value = categories.value.includes(category) ? categories.value.filter((item) => item !== category) : [...categories.value, category];
    });

  const countText = computed(() => `${view.value.matchCount} ${view.value.matchCount === 1 ? "product" : "products"}`);
  const chipCategories = computed(() => view.value.categories);

  return (
    <div class="flex flex-col gap-shop-vsp-md" on:shop-grid-item={answerLink(GRID_ITEM_LINK, host)}>
      {toolbar && (
        <div class="flex flex-col gap-shop-vsp-sm border-b border-shop-border pb-shop-vsp-sm shop-md:flex-row shop-md:items-center shop-md:justify-between">
          <p class={`${CAPS} text-shop-muted`} aria-live="polite">
            {countText}
          </p>
          <div class="flex flex-wrap items-center gap-shop-hsp-xs">
            {chips && (
              <For each={chipCategories} by={(category) => category}>
                {(category) => {
                  const active = computed(() => categories.value.includes(category.value));
                  return (
                    <button
                      type="button"
                      aria-pressed={active}
                      on:click={() => toggleCategory(category.value)}
                      class={computed(() => `h-shop-control-h px-shop-hsp-sm border text-shop-body hover:bg-shop-inverse-bg hover:text-shop-inverse-fg ${active.value ? "border-shop-fg-strong bg-shop-surface-2 text-shop-fg-strong" : "border-shop-border text-shop-fg"}`)}
                    >
                      {label(category.value)}
                    </button>
                  );
                }}
              </For>
            )}
            <label class="flex items-center gap-shop-hsp-xs text-shop-caption text-shop-muted">
              <span class="uppercase tracking-shop-caps">Sort</span>
              <select
                modelValue={sort}
                on:change={() => {
                  page.value = 1;
                }}
                // A non-default sort earns the accent underline (§ 3 accent uses).
                class={computed(() => `${CONTROL} ${activeSort.value === defaultSort ? "" : "border-b-2 border-b-shop-accent"}`)}
              >
                {SHOP_SORTS.map((option) => <option value={option}>{SORT_LABEL[option]}</option>)}
              </select>
            </label>
            <input type="search" aria-label="Search products" placeholder="Search" modelValue={searchInput} class={CONTROL} />
          </div>
        </div>
      )}
      <div class="grid grid-cols-1 gap-x-shop-hsp-md gap-y-shop-vsp-lg shop-sm:grid-cols-2 shop-lg:grid-cols-3 shop-lg:gap-x-shop-hsp-lg shop-xl:grid-cols-4">{items as Child}</div>
      <Show when={computed(() => ordered.value.length > 0 && view.value.matchCount === 0)}>
        {() => <p class="text-shop-body text-shop-muted">{emptyText}</p>}
      </Show>
      {toolbar && (
        <Show when={computed(() => view.value.pageCount > 1)}>
          {() => (
            <PaginationControls
              page={computed(() => view.value.page)}
              pageCount={computed(() => view.value.pageCount)}
              onPage={(next) => {
                page.value = next;
              }}
            />
          )}
        </Show>
      )}
    </div>
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
