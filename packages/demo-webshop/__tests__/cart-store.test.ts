import { describe, expect, it } from "vitest";
import { CART_STORAGE_KEY, cartCount, cartSubtotal, createCartStore } from "../components/cart-store";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), data };
}

const pen = { slug: "field-pen", name: "Field Pen", price: 42, currency: "USD", src: "/p" };
const lamp = { slug: "wick-lamp", name: "Wick Lamp", price: 148, currency: "USD", src: "/l" };

describe("cart store", () => {
  it("adds lines and merges repeated adds", () => {
    const store = createCartStore(() => memoryStorage());
    store.add(pen);
    store.add(pen, 2);
    store.add(lamp);
    expect(store.get().lines.map((line) => [line.slug, line.qty])).toEqual([["field-pen", 3], ["wick-lamp", 1]]);
    expect(cartCount(store.get())).toBe(4);
  });

  it("removes a line", () => {
    const store = createCartStore(() => memoryStorage());
    store.add(pen);
    store.add(lamp);
    store.remove("field-pen");
    expect(store.get().lines.map((line) => line.slug)).toEqual(["wick-lamp"]);
  });

  it("sets quantity and removes at zero", () => {
    const store = createCartStore(() => memoryStorage());
    store.add(pen);
    store.setQuantity("field-pen", 5);
    expect(store.get().lines[0]?.qty).toBe(5);
    store.setQuantity("field-pen", 0);
    expect(store.get().lines).toEqual([]);
  });

  it("totals to the cent", () => {
    const store = createCartStore(() => memoryStorage());
    store.add({ ...pen, price: 0.1 }, 3);
    store.add(lamp, 2);
    expect(cartSubtotal(store.get())).toBe(296.3);
    store.clear();
    expect(cartSubtotal(store.get())).toBe(0);
  });

  it("notifies subscribers until they unsubscribe", () => {
    const store = createCartStore(() => memoryStorage());
    const counts: number[] = [];
    const unsubscribe = store.subscribe((state) => counts.push(cartCount(state)));
    store.add(pen);
    unsubscribe();
    store.add(pen);
    expect(counts).toEqual([1]);
  });

  it("round-trips through storage under one key", () => {
    const storage = memoryStorage();
    const first = createCartStore(() => storage);
    first.add(pen, 2);
    first.add(lamp);
    expect([...storage.data.keys()]).toEqual([CART_STORAGE_KEY]);
    const second = createCartStore(() => storage);
    expect(second.get()).toEqual(first.get());
  });

  it("survives corrupt data and throwing storage", () => {
    expect(createCartStore(() => memoryStorage({ [CART_STORAGE_KEY]: "{not json" })).get().lines).toEqual([]);
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    const store = createCartStore(() => throwing);
    store.add(pen);
    expect(cartCount(store.get())).toBe(1);
    expect(createCartStore(() => undefined).get().lines).toEqual([]);
  });

  it("drops malformed persisted lines", () => {
    const raw = JSON.stringify({ lines: [{ ...pen, qty: 2 }, { slug: "x" }, { ...lamp, qty: 0 }] });
    expect(createCartStore(() => memoryStorage({ [CART_STORAGE_KEY]: raw })).get().lines).toEqual([{ ...pen, qty: 2 }]);
  });
});
