// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { render as renderToString } from "preact-render-to-string";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BILLING_STORAGE_KEY } from "../components/pricing";
import { renderNode, type TestNode } from "./render-node";

// Shaped like the compiler's output for the `home-tiers` attachment: one
// `land.pricing-tier` node per tiers entry, appended to the table's slot.
const TIERS = [
  { name: "Solo", priceMonthly: 0, priceYearly: 0, popular: false, ctaLabel: "Start free", order: 1 },
  { name: "Studio", priceMonthly: 12, priceYearly: 10, popular: true, ctaLabel: "Start trial", order: 2 },
  { name: "Org", priceMonthly: 29, priceYearly: 24, popular: false, ctaLabel: "Talk to us", order: 3 },
];

function pricingTable(props: Record<string, unknown> = {}): TestNode {
  return {
    id: "home-pricing",
    componentId: "land.pricing-table",
    props,
    slots: {
      tiers: TIERS.map((tier, index) => ({
        id: `home-pricing-tier-${index + 1}`,
        componentId: "land.pricing-tier",
        props: { ...tier, tagline: "", currency: "USD", ctaHref: "/#signup", feature1: "Calendar sync", feature2: "", feature3: "", feature4: "", feature5: "", feature6: "" },
      })),
    },
  };
}

const prices = () => [...document.querySelectorAll("[data-price]")].map((element) => element.textContent);

describe("land.pricing-table billing toggle", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(cleanup);

  it("switches every materialised tier between monthly and yearly prices", () => {
    render(renderNode(pricingTable()));
    const toggle = screen.getByRole("switch", { name: "Bill yearly" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(prices()).toEqual(["$0", "$12", "$29"]);
    expect(screen.getAllByText("per month")).toHaveLength(3);

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(prices()).toEqual(["$0", "$10", "$24"]);
    expect(screen.getAllByText("per month, billed yearly")).toHaveLength(3);
    expect(window.localStorage.getItem(BILLING_STORAGE_KEY)).toBe("yearly");

    fireEvent.click(toggle);
    expect(prices()).toEqual(["$0", "$12", "$29"]);
    expect(window.localStorage.getItem(BILLING_STORAGE_KEY)).toBe("monthly");
  });

  it("restores the stored billing choice over the default", () => {
    window.localStorage.setItem(BILLING_STORAGE_KEY, "yearly");
    render(renderNode(pricingTable({ defaultBilling: "monthly" })));
    expect(prices()).toEqual(["$0", "$10", "$24"]);
  });

  it("starts from the default billing and frames only the popular tier", () => {
    render(renderNode(pricingTable({ defaultBilling: "yearly" })));
    expect(prices()).toEqual(["$0", "$10", "$24"]);
    const framed = document.querySelectorAll("article.border-land-accent");
    expect(framed).toHaveLength(1);
    expect(framed[0]!.textContent).toContain("Popular");
    expect([...document.querySelectorAll("article a")].every((link) => !link.className.includes("bg-land-accent"))).toBe(true);
  });

  it("renders a tier outside any table at its monthly price", () => {
    const output = renderToString(renderNode({ id: "tier", componentId: "land.pricing-tier", props: { priceMonthly: 29, priceYearly: 24 } }));
    expect(output).toContain(">$29</span>");
    expect(output).toContain("per month");
  });
});
