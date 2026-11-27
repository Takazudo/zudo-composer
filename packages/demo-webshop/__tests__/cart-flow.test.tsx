// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AddToCart,
  CartButton,
  CartPage,
  CartSummary,
  CheckoutForm,
  ContactForm,
  Header,
  Newsletter,
  GalleryImage,
  ProductCard,
  ProductGallery,
  RelatedProducts,
  cartStore,
} from "../components/pack";
import { fireEvent, render, screen, settle, within } from "./render";

const PEN = { slug: "field-pen", name: "Field Pen", price: 42, currency: "USD", src: "/pen" } as const;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  cartStore.clear();
});

afterEach(() => {
  cartStore.clear();
  vi.useRealTimers();
});

const summaryTotal = () => document.querySelector('[data-total="total"]')?.textContent;

describe("add to cart", () => {
  it("updates the header count and the cart summary total", async () => {
    render(
      <>
        <Header brand="Nightjar Supply" brandHref="/" actions={<CartButton label="Cart" href="/cart" />} />
        <AddToCart {...PEN} availability="in-stock" maxQuantity={3} />
        <CartSummary shipping={8} currency="USD" checkoutHref="/checkout" readOnly={false} />
      </>,
    );
    await settle();
    expect(screen.getByRole("link", { name: "Cart" })).toBeTruthy();
    expect(summaryTotal()).toBe("$0.00");

    fireEvent.click(screen.getByRole("button", { name: "Increase quantity" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));
    await settle();

    expect(screen.getByRole("link", { name: "Cart, 2 items" }).textContent).toContain("2");
    expect(summaryTotal()).toBe("$92.00");
    expect(screen.getByRole("status").textContent).toContain("Added — view cart");
    expect(screen.getByRole("link", { name: "Checkout" }).getAttribute("href")).toBe("/checkout");
    expect(JSON.parse(localStorage.getItem("nightjar-cart-v1") ?? "{}").lines[0]).toMatchObject({ slug: "field-pen", qty: 2 });

    vi.advanceTimersByTime(2000);
    await settle();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("caps the stepper at maxQuantity", async () => {
    render(<AddToCart {...PEN} availability="low-stock" maxQuantity={2} />);
    await settle();
    const increase = screen.getByRole("button", { name: "Increase quantity" }) as HTMLButtonElement;
    fireEvent.click(increase);
    await settle();
    expect(increase.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Decrease quantity" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("is disabled and writes nothing when sold out", async () => {
    render(<AddToCart {...PEN} availability="sold-out" maxQuantity={10} />);
    await settle();
    const button = screen.getByRole("button", { name: "Sold out" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    await settle();
    expect(cartStore.get().lines).toEqual([]);
  });
});

describe("cart page", () => {
  it("changes quantities, removes lines and recomputes totals", async () => {
    cartStore.add(PEN, 1);
    cartStore.add({ slug: "candle-set", name: "Candle Set", price: 28, currency: "USD", src: "" }, 2);
    render(
      <>
        <CartPage emptyText="Your cart is empty." emptyHref="/products" />
        <CartSummary shipping={8} currency="USD" checkoutHref="/checkout" readOnly={false} />
      </>,
    );
    await settle();
    expect(summaryTotal()).toBe("$106.00");

    fireEvent.click(screen.getByRole("button", { name: "Increase quantity of Field Pen" }));
    await settle();
    expect(summaryTotal()).toBe("$148.00");
    expect(screen.getByLabelText("Line total for Field Pen").textContent).toBe("$84.00");

    fireEvent.click(screen.getByRole("button", { name: "Remove Candle Set" }));
    await settle();
    expect(summaryTotal()).toBe("$92.00");

    fireEvent.click(screen.getByRole("button", { name: "Decrease quantity of Field Pen" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Decrease quantity of Field Pen" }));
    await settle();
    expect(screen.getByText("Your cart is empty.")).toBeTruthy();
    expect(summaryTotal()).toBe("$0.00");
  });
});

describe("checkout", () => {
  const fill = (values: Record<string, string>) => {
    for (const [name, value] of Object.entries(values)) {
      const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!;
      fireEvent.input(control, { target: { value } });
    }
  };

  it("shows inline errors for an invalid submit and sends nothing", async () => {
    cartStore.add(PEN, 1);
    render(<CheckoutForm heading="Checkout" successHeading="Order placed" successText="Thanks" />);
    await settle();
    fill({ name: "Ada", email: "not-an-email", card: "1234" });
    fireEvent.click(screen.getByRole("button", { name: "Place order" }));
    await settle();

    expect(screen.getByText("Enter an email like you@example.com.")).toBeTruthy();
    expect(screen.getByText("Card number must be 16 digits.")).toBeTruthy();
    expect(screen.getByText("Address is required.")).toBeTruthy();
    expect(document.querySelector('[name="email"]')?.getAttribute("aria-invalid")).toBe("true");
    expect(document.querySelector('[name="name"]')?.hasAttribute("aria-invalid")).toBe(false);
    vi.advanceTimersByTime(1000);
    await settle();
    expect(cartStore.get().lines).toHaveLength(1);
    expect(screen.getByText("Demo — no data is sent.")).toBeTruthy();
  });

  it("waits 600 ms, shows a fake order number and empties the cart", async () => {
    cartStore.add(PEN, 2);
    render(
      <>
        <CheckoutForm heading="Checkout" successHeading="Order placed" successText="Thanks" />
        <CartSummary shipping={8} currency="USD" checkoutHref="/checkout" readOnly />
      </>,
    );
    await settle();
    expect(summaryTotal()).toBe("$92.00");
    fill({ name: "Ada", email: "ada@example.com", address: "1 Lane", city: "Town", postcode: "12345", country: "Japan", card: "4242 4242 4242 4242", expiry: "04/29", cvc: "123" });
    fireEvent.click(screen.getByRole("button", { name: "Place order" }));
    await settle();

    const pending = screen.getByRole("button", { name: "Placing order…" }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    vi.advanceTimersByTime(599);
    await settle();
    expect(cartStore.get().lines).toHaveLength(1);

    vi.advanceTimersByTime(1);
    await settle();
    const panel = screen.getByRole("status");
    expect(within(panel).getByRole("heading", { name: "Order placed" })).toBeTruthy();
    expect(panel.textContent).toMatch(/NJ-\d{6}/);
    expect(within(panel).getByText("Demo — no data is sent.")).toBeTruthy();
    expect(cartStore.get().lines).toEqual([]);
    expect(summaryTotal()).toBe("$0.00");
  });
});

describe("newsletter and contact mocks", () => {
  it("checks the newsletter email, then thanks after the delay", async () => {
    render(<Newsletter heading="Letters" lead="" buttonLabel="Subscribe" />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    await settle();
    expect(screen.getByText("Enter an email like you@example.com.")).toBeTruthy();
    fireEvent.input(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    await settle();
    vi.advanceTimersByTime(600);
    await settle();
    expect(screen.getByRole("status").textContent).toBe("Thanks — this demo keeps nothing.");
    expect(screen.getByText("Demo — no data is sent.")).toBeTruthy();
  });

  it("requires every contact field, then shows the success text", async () => {
    render(<ContactForm heading="Write to us" successText="We got it." />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await settle();
    expect(screen.getByText("Message is required.")).toBeTruthy();
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    await settle();
    fireEvent.input(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    await settle();
    fireEvent.input(screen.getByLabelText("Message"), { target: { value: "Hello" } });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await settle();
    vi.advanceTimersByTime(600);
    await settle();
    expect(screen.getByRole("status").textContent).toBe("We got it.");
  });
});

describe("gallery and related strip", () => {
  it("moves the gallery selection with arrow keys", async () => {
    render(<ProductGallery images={["/a", "/b", "/c"].map((src) => <GalleryImage key={src} src={src} alt={src} />)} />);
    await settle();
    const main = () => document.querySelector<HTMLImageElement>("img:not([hidden])")!.getAttribute("src");
    const first = screen.getByRole("button", { name: "Show image 1 of 3" });
    expect(main()).toBe("/a");
    fireEvent.keyDown(first, { key: "ArrowRight" });
    await settle();
    expect(main()).toBe("/b");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Show image 2 of 3" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    await settle();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    await settle();
    expect(main()).toBe("/c");
    fireEvent.click(screen.getByRole("button", { name: "Show image 1 of 3" }));
    await settle();
    expect(main()).toBe("/a");
  });

  it("hides the current product and shows at most the limit", async () => {
    history.replaceState(null, "", "/products/sling-pouch");
    const slugs = ["ledger-notebook", "sling-pouch", "field-pen", "wick-lamp"];
    render(
      <RelatedProducts heading="" limit={2} items={slugs.map((slug) => (
        <ProductCard key={slug} name={slug} href={`/products/${slug}`} src="" alt="" price={1} currency="USD" category="desk" availability="in-stock" stockLabel="" slug={slug} featured tag1="" tag2="" tag3="" />
      ))} />,
    );
    await settle();
    const visible = [...document.querySelectorAll<HTMLAnchorElement>("a[data-slug]")].filter((card) => !card.hidden).map((card) => card.dataset.slug);
    expect(visible).toEqual(["ledger-notebook", "field-pen"]);
    history.replaceState(null, "", "/");
  });
});
