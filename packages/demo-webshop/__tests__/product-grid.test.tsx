// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductCard, ProductGrid } from "../components/pack";

const PRODUCTS = [
  { slug: "ledger-notebook", name: "Ledger Notebook A5", price: 24, category: "desk", featured: true, tag1: "paper" },
  { slug: "brass-rule", name: "Brass Rule 30 cm", price: 38, category: "desk", featured: false, tag1: "brass" },
  { slug: "sling-pouch", name: "Sling Pouch", price: 64, category: "carry", featured: true, tag1: "canvas" },
  { slug: "wick-lamp", name: "Wick Lamp", price: 148, category: "light", featured: true, tag1: "brass" },
  { slug: "candle-set", name: "Candle Set", price: 28, category: "light", featured: false, tag1: "wax" },
] as const;

let host: HTMLElement;

function mount(props: Partial<Parameters<typeof ProductGrid>[0]> = {}) {
  act(() => {
    render(
      <ProductGrid toolbar chips pageSize={8} defaultSort="name" emptyText="Nothing here" {...props}
        items={PRODUCTS.map((product) => (
          <ProductCard key={product.slug} name={product.name} href={`/products/${product.slug}`} src="" alt="" price={product.price} currency="USD"
            category={product.category} availability="in-stock" stockLabel="In stock" slug={product.slug} featured={product.featured} tag1={product.tag1} tag2="" tag3="" />
        ))}
      />,
      host,
    );
  });
}

const cards = () => [...host.querySelectorAll<HTMLAnchorElement>("a[data-slug]")];
const visible = () => cards().filter((card) => !card.hidden).sort((a, b) => Number(a.style.order) - Number(b.style.order)).map((card) => card.dataset.slug);

beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState(null, "", "/products");
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.useRealTimers();
});

describe("shop.product-grid over materialised card children", () => {
  it("keeps DOM order and expresses the sort with CSS order", () => {
    mount();
    expect(cards().map((card) => card.dataset.slug)).toEqual(PRODUCTS.map((product) => product.slug));
    expect(visible()).toEqual(["brass-rule", "candle-set", "ledger-notebook", "sling-pouch", "wick-lamp"]);
    expect(host.textContent).toContain("5 products");
  });

  it("re-sorts by price when the sort select changes", () => {
    mount();
    const select = host.querySelector("select")!;
    act(() => {
      select.value = "price-desc";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(visible()).toEqual(["wick-lamp", "sling-pouch", "brass-rule", "candle-set", "ledger-notebook"]);
    expect(location.search).toBe("?sort=price-desc");
  });

  it("filters with multi-select category chips", () => {
    mount();
    const chip = (label: string) => [...host.querySelectorAll("button")].find((button) => button.textContent === label)!;
    expect([...host.querySelectorAll("button[aria-pressed]")].map((button) => button.textContent)).toEqual(["Desk", "Carry", "Light"]);
    act(() => chip("Light").click());
    expect(visible()).toEqual(["candle-set", "wick-lamp"]);
    act(() => chip("Carry").click());
    expect(visible()).toEqual(["candle-set", "sling-pouch", "wick-lamp"]);
    expect(host.textContent).toContain("3 products");
    expect(new URLSearchParams(location.search).get("cat")).toBe("light,carry");
  });

  it("searches name and tags after the debounce", () => {
    mount();
    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    act(() => {
      input.value = "brass";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(visible()).toHaveLength(5);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(visible()).toEqual(["brass-rule", "wick-lamp"]);
    act(() => {
      input.value = "zzz";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(visible()).toEqual([]);
    expect(host.textContent).toContain("Nothing here");
  });

  it("paginates and hides cards on other pages", () => {
    mount({ pageSize: 4 });
    expect(visible()).toEqual(["brass-rule", "candle-set", "ledger-notebook", "sling-pouch"]);
    const next = host.querySelector<HTMLButtonElement>('button[aria-label="Next page"]')!;
    act(() => next.click());
    expect(visible()).toEqual(["wick-lamp"]);
    expect(new URLSearchParams(location.search).get("page")).toBe("2");
  });

  it("restores shareable state from the URL", () => {
    history.replaceState(null, "", "/products?cat=desk&sort=price-desc");
    mount();
    expect(visible()).toEqual(["brass-rule", "ledger-notebook"]);
  });

  it("applies no filtering or pagination with the toolbar off", () => {
    mount({ toolbar: false, pageSize: 4, defaultSort: "featured" });
    expect(host.querySelector("select")).toBeNull();
    expect(visible()).toEqual(["ledger-notebook", "sling-pouch", "wick-lamp", "brass-rule", "candle-set"]);
  });
});
