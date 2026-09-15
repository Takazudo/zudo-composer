import { useEffect, useState } from "preact/hooks";

export interface CartLine {
  readonly slug: string;
  readonly name: string;
  readonly price: number;
  readonly currency: string;
  readonly src: string;
  readonly qty: number;
}

export interface CartState {
  readonly lines: readonly CartLine[];
}

export type CartItem = Omit<CartLine, "qty">;

export const CART_STORAGE_KEY = "nightjar-cart-v1";

const EMPTY: CartState = { lines: [] };

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function parseLines(value: unknown): CartLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((line): CartLine[] => {
    if (typeof line !== "object" || line === null) return [];
    const { slug, name, price, currency, src, qty } = line as Record<string, unknown>;
    if (typeof slug !== "string" || typeof name !== "string" || typeof price !== "number" || typeof qty !== "number" || qty < 1) return [];
    return [{ slug, name, price, currency: typeof currency === "string" ? currency : "USD", src: typeof src === "string" ? src : "", qty: Math.floor(qty) }];
  });
}

export function cartCount(state: CartState): number {
  return state.lines.reduce((sum, line) => sum + line.qty, 0);
}

export function cartSubtotal(state: CartState): number {
  return Math.round(state.lines.reduce((sum, line) => sum + line.price * line.qty, 0) * 100) / 100;
}

export function createCartStore(storage: () => StorageLike | undefined = browserStorage) {
  let state: CartState | null = null;
  const listeners = new Set<(state: CartState) => void>();

  function load(): CartState {
    try {
      const raw = storage()?.getItem(CART_STORAGE_KEY);
      return raw ? { lines: parseLines((JSON.parse(raw) as { lines?: unknown }).lines) } : EMPTY;
    } catch {
      return EMPTY;
    }
  }

  function get(): CartState {
    state ??= load();
    return state;
  }

  function set(next: CartState): void {
    state = next;
    try {
      storage()?.setItem(CART_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private windows and blocked site data: the cart still works for this page view.
    }
    for (const listener of listeners) listener(next);
  }

  function setQuantity(slug: string, qty: number): void {
    const whole = Math.floor(qty);
    const lines = get().lines;
    set({ lines: whole < 1 ? lines.filter((line) => line.slug !== slug) : lines.map((line) => (line.slug === slug ? { ...line, qty: whole } : line)) });
  }

  return {
    get,
    set,
    subscribe(listener: (state: CartState) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    add(item: CartItem, qty = 1): void {
      const lines = get().lines;
      const existing = lines.find((line) => line.slug === item.slug);
      if (existing) setQuantity(item.slug, existing.qty + qty);
      else if (qty >= 1) set({ lines: [...lines, { ...item, qty: Math.floor(qty) }] });
    },
    remove(slug: string): void {
      set({ lines: get().lines.filter((line) => line.slug !== slug) });
    },
    setQuantity,
    clear(): void {
      set(EMPTY);
    },
  };
}

export type CartStore = ReturnType<typeof createCartStore>;

export const cartStore = createCartStore();

export function useCart(store: CartStore = cartStore) {
  const [state, setState] = useState(store.get);
  useEffect(() => {
    setState(store.get());
    return store.subscribe(setState);
  }, [store]);
  return {
    lines: state.lines,
    count: cartCount(state),
    subtotal: cartSubtotal(state),
    add: store.add,
    remove: store.remove,
    setQuantity: store.setQuantity,
    clear: store.clear,
  };
}
