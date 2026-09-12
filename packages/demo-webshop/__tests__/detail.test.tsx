import { render } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import {
  AddToCart,
  CartPage,
  CartSummary,
  CheckoutForm,
  ContactForm,
  GalleryImage,
  Newsletter,
  ProductCard,
  ProductGallery,
  ProductHero,
  RelatedProducts,
  SpecTable,
} from "../components/pack";
import { fakeOrderNumber, validateCheckout } from "../components/checkout-form";
import { validateContact } from "../components/contact-form";
import { cartTotals } from "../components/cart-summary";
import { computeRelatedView } from "../components/grid-view";
import { currentRouteSlug } from "../components/related-products";
import { specRows } from "../components/spec-table";

const DEMO_NOTE = "Demo — no data is sent.";

describe("product detail rendering", () => {
  it("renders the product hero slots at the chosen ratio", () => {
    const html = render(<ProductHero ratio="3/2" media={<p>M</p>} copy={[<p>C</p>]} />);
    expect(html).toContain("shop-lg:grid-cols-[3fr_2fr]");
    expect(html).toContain("<p>M</p>");
    expect(html).toContain("<p>C</p>");
  });

  it("renders gallery image children before any registration, without thumbnails", () => {
    const html = render(<ProductGallery images={[<GalleryImage src="/a" alt="A" />, <GalleryImage src="" alt="" />]} />);
    expect(html).toContain('src="/a"');
    expect(html.match(/<img/g)).toHaveLength(1);
    expect(html).not.toContain("Show image");
  });

  it("shows a gallery image outside a gallery", () => {
    expect(render(<GalleryImage src="/a" alt="A" />)).toContain('alt="A"');
    expect(render(<GalleryImage src="" alt="A" />)).toBe("");
  });

  it("renders spec rows in mono and skips empty pairs", () => {
    const html = render(
      <SpecTable spec1Label="Material" spec1Value="Brass" spec2Label="Weight" spec2Value="" spec3Label="" spec3Value="x" spec4Label="Origin" spec4Value="Japan"
        spec5Label="Care" spec5Value="" spec6Label="Warranty" spec6Value="" />,
    );
    expect(html).toContain("Brass");
    expect(html).toContain("Japan");
    expect(html).not.toContain("Weight");
    expect(html.match(/<tr/g)).toHaveLength(2);
    expect(html).toContain("font-shop-mono");
  });

  it("renders nothing for an empty spec table", () => {
    expect(render(<SpecTable spec1Label="" spec1Value="" spec2Label="" spec2Value="" spec3Label="" spec3Value="" spec4Label="" spec4Value="" spec5Label="" spec5Value="" spec6Label="" spec6Value="" />)).toBe("");
  });

  it("renders add to cart with a stepper and primary button", () => {
    const html = render(<AddToCart slug="field-pen" name="Field Pen" price={42} currency="USD" src="" availability="in-stock" maxQuantity={10} />);
    expect(html).toContain("Add to cart");
    expect(html).toContain('aria-label="Decrease quantity"');
    expect(html).toContain("bg-shop-inverse-bg");
  });

  it("disables add to cart when sold out", () => {
    const html = render(<AddToCart slug="rain-cape" name="Rain Cape" price={96} currency="USD" src="" availability="sold-out" maxQuantity={10} />);
    expect(html).toContain("disabled");
    expect(html).toContain("Sold out");
    expect(html).not.toContain("Decrease quantity");
  });

  it("renders related products with a heading and card children", () => {
    const html = render(
      <RelatedProducts heading="More from the shelf" limit={3} items={[
        <ProductCard name="Field Pen" href="/products/field-pen" src="" alt="" price={42} currency="USD" category="desk" availability="in-stock" stockLabel="" slug="field-pen" featured tag1="" tag2="" tag3="" />,
      ]} />,
    );
    expect(html).toContain("More from the shelf");
    expect(html).toContain('href="/products/field-pen"');
  });
});

describe("cart and forms rendering", () => {
  it("renders the empty cart state with a link back to the catalog", () => {
    const html = render(<CartPage emptyText="Nothing here yet." emptyHref="/products" />);
    expect(html).toContain("Nothing here yet.");
    expect(html).toContain('href="/products"');
  });

  it("renders an empty summary without shipping or a checkout button", () => {
    const html = render(<CartSummary shipping={8} currency="USD" checkoutHref="/checkout" readOnly={false} />);
    expect(html).toContain("$0.00");
    expect(html).not.toContain("$8.00");
    expect(html).not.toContain('href="/checkout"');
  });

  it("renders the checkout form with every field and the demo note", () => {
    const html = render(<CheckoutForm heading="Checkout" successHeading="Done" successText="Thanks" />);
    for (const name of ["name", "email", "address", "city", "postcode", "country", "card", "expiry", "cvc"]) expect(html).toContain(`name="${name}"`);
    expect(html).toContain("Place order");
    expect(html).toContain(DEMO_NOTE);
  });

  it("renders the newsletter and contact mocks with the demo note", () => {
    const newsletter = render(<Newsletter heading="Letters" lead="Lead" buttonLabel="Join" />);
    expect(newsletter).toContain("Join");
    expect(newsletter).toContain(DEMO_NOTE);
    const contact = render(<ContactForm heading="Write" successText="Sent" />);
    expect(contact).toContain('name="message"');
    expect(contact).toContain(DEMO_NOTE);
  });
});

describe("detail logic", () => {
  const valid = { name: "Ada", email: "ada@example.com", address: "1 Lane", city: "Town", postcode: "12345", country: "Japan", card: "4242 4242 4242 4242", expiry: "04/29", cvc: "123" };

  it("accepts a complete checkout", () => {
    expect(validateCheckout(valid)).toEqual({});
  });

  it("reports required, email, card, expiry and cvc errors", () => {
    expect(Object.keys(validateCheckout({ ...valid, name: " ", country: "" }))).toEqual(["name", "country"]);
    expect(validateCheckout({ ...valid, email: "ada" }).email).toMatch(/email/i);
    expect(validateCheckout({ ...valid, card: "4242" }).card).toBe("Card number must be 16 digits.");
    expect(validateCheckout({ ...valid, expiry: "13/29" }).expiry).toBe("Use MM/YY.");
    expect(validateCheckout({ ...valid, cvc: "12" }).cvc).toBeDefined();
  });

  it("makes NJ- plus six digits order numbers", () => {
    expect(fakeOrderNumber(() => 0.000042)).toBe("NJ-000042");
    expect(fakeOrderNumber()).toMatch(/^NJ-\d{6}$/);
  });

  it("validates the contact form", () => {
    expect(validateContact({ name: "", email: "x", message: "" })).toEqual({ name: "Name is required.", email: "Enter an email like you@example.com.", message: "Message is required." });
  });

  it("charges shipping only for a non-empty cart", () => {
    expect(cartTotals(0, 0, 8)).toEqual({ subtotal: 0, shipping: 0, total: 0 });
    expect(cartTotals(24.5, 2, 8)).toEqual({ subtotal: 24.5, shipping: 8, total: 32.5 });
  });

  it("hides the current product and caps the related strip", () => {
    const data = (slug: string) => ({ slug, name: slug, price: 1, category: "desk", featured: true, tags: [] });
    const views = computeRelatedView([["a", data("a")], ["b", data("b")], ["c", data("c")], ["d", data("d")]], "b", 2);
    expect([...views].map(([id, view]) => [id, view.hidden])).toEqual([["a", false], ["b", true], ["c", false], ["d", true]]);
    expect(currentRouteSlug("/products/field-pen/")).toBe("field-pen");
    expect(currentRouteSlug("/")).toBe("");
  });

  it("keeps only complete spec pairs", () => {
    expect(specRows({ spec1Label: "Material", spec1Value: "Linen", spec2Label: "Weight", spec2Value: " " })).toEqual([{ label: "Material", value: "Linen" }]);
  });
});
