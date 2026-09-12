import { render } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import {
  Breadcrumbs,
  CartButton,
  CategoryTile,
  Container,
  DemoNote,
  FaqAccordion,
  FaqItem,
  Footer,
  Grid,
  Header,
  Hero,
  Image,
  NavLink,
  Pagination,
  PriceTag,
  ProductCard,
  ProductGrid,
  Prose,
  Section,
  SectionHeading,
  Split,
  Stack,
  StatusBadge,
} from "../components/pack";

describe("chrome", () => {
  it("renders the header with brand, nav slot and actions slot", () => {
    const html = render(<Header brand="Nightjar Supply" brandHref="/" nav={[<NavLink label="Desk" href="/desk" />]} actions={<CartButton label="Cart" href="/cart" />} />);
    expect(html).toContain('href="/"');
    expect(html).toContain("Nightjar Supply");
    expect(html).toContain('href="/desk"');
    expect(html).toContain('href="/cart"');
    expect(html).toContain("sticky");
  });

  it("renders the cart button without a count dot for an empty cart", () => {
    const html = render(<CartButton label="Cart" href="/cart" />);
    expect(html).toContain(">Cart<");
    expect(html).not.toContain("rounded-shop-dot");
  });

  it("renders a nav link at rest", () => {
    expect(render(<NavLink label="About" href="/about" />)).toContain('href="/about"');
  });

  it("renders the footer credit link", () => {
    const html = render(<Footer smallPrint="Small" creditLabel="Built with zudo-composer" creditHref="https://github.com/Takazudo/zudo-composer" nav={[<NavLink label="FAQ" href="/faq" />]} />);
    expect(html).toContain('href="https://github.com/Takazudo/zudo-composer"');
    expect(html).toContain("Built with zudo-composer");
    expect(html).toContain('href="/faq"');
  });

  it("renders breadcrumbs with the last item as the current page", () => {
    const html = render(<Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Field Pen", href: "/products/field-pen" }]} />);
    expect(html).toContain('href="/"');
    expect(html).toContain('<span aria-current="page" class="text-shop-fg">Field Pen</span>');
  });

  it("renders the demo note", () => {
    expect(render(<DemoNote text="Demo — no data is sent." />)).toContain("Demo — no data is sent.");
  });
});

describe("layout", () => {
  it("renders container widths", () => {
    expect(render(<Container width="prose">x</Container>)).toContain("max-w-shop-prose");
    expect(render(<Container width="page">x</Container>)).toContain("max-w-shop-page");
  });

  it("renders stack gap and alignment", () => {
    expect(render(<Stack gap="lg" align="center">x</Stack>)).toContain("gap-shop-vsp-lg items-center");
  });

  it("renders grid columns up to the chosen count", () => {
    const html = render(<Grid columns="4" gap="lg" items={[<p>a</p>]} />);
    expect(html).toContain("shop-xl:grid-cols-4");
    expect(html).toContain("gap-x-shop-hsp-lg");
  });

  it("renders split slots", () => {
    const html = render(<Split ratio="2/3" left={<p>L</p>} right={[<p>R</p>]} />);
    expect(html).toContain("shop-md:grid-cols-[2fr_3fr]");
    expect(html).toContain("<p>L</p>");
    expect(html).toContain("<p>R</p>");
  });

  it("renders the section tone", () => {
    expect(render(<Section tone="surface">x</Section>)).toContain("bg-shop-surface");
  });

  it("renders a section heading at the requested level", () => {
    const html = render(<SectionHeading eyebrow="Shelf" heading="All products" intro="" as="h1" />);
    expect(html).toContain("<h1");
    expect(html).toContain("All products");
    expect(html).toContain("Shelf");
  });
});

describe("catalog", () => {
  const card = { name: "Field Pen", href: "/products/field-pen", src: "/uploaded-assets/asset-1", alt: "Pen", price: 42, currency: "USD", category: "desk", availability: "low-stock", stockLabel: "Only a few left", slug: "field-pen", featured: true, tag1: "pen", tag2: "", tag3: "" } as const;

  it("renders a product card visible and unordered outside a grid", () => {
    const html = render(<ProductCard {...card} />);
    expect(html).toContain('href="/products/field-pen"');
    expect(html).toContain('src="/uploaded-assets/asset-1"');
    expect(html).toContain("$42.00");
    expect(html).toContain("Only a few left");
    expect(html).not.toContain("hidden=");
    expect(html).not.toContain("order");
  });

  it("omits the badge for in-stock products", () => {
    expect(render(<ProductCard {...card} availability="in-stock" stockLabel="In stock" />)).not.toContain("In stock");
  });

  it("renders a category tile", () => {
    expect(render(<CategoryTile label="Desk" href="/desk" src="/a" alt="Desk" caption="4 objects" />)).toContain("4 objects");
  });

  it("colours the status badge by availability only", () => {
    expect(render(<StatusBadge availability="low-stock" label="Only a few left" />)).toContain("text-shop-accent");
    expect(render(<StatusBadge availability="sold-out" label="Sold out" />)).toContain("text-shop-danger");
    expect(render(<StatusBadge availability="in-stock" label="In stock" />)).toContain("text-shop-muted");
  });

  it("formats prices as currency in mono", () => {
    const html = render(<PriceTag price={148} currency="USD" size="h2" />);
    expect(html).toContain("$148.00");
    expect(html).toContain("font-shop-mono tabular-nums text-shop-price text-shop-h2");
  });

  it("renders standalone pagination as links", () => {
    const html = render(<Pagination page={2} pageCount={3} />);
    expect(html).toContain('href="?page=1"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="?page=3"');
  });

  it("renders a product grid shell with its toolbar", () => {
    const html = render(<ProductGrid toolbar chips pageSize={8} defaultSort="featured" emptyText="None" items={[<ProductCard {...card} />]} />);
    expect(html).toContain('aria-label="Search products"');
    expect(html).toContain("Field Pen");
  });
});

describe("content", () => {
  it("renders the hero with an accent emphasised word and two actions", () => {
    const html = render(<Hero src="/h" alt="Bench" eyebrow="Nightjar Supply" heading="Objects for *quiet* work" lead="Lead" primaryLabel="Shop all" primaryHref="/products" secondaryLabel="About" secondaryHref="/about" variant="display" />);
    expect(html).toContain('<span class="text-shop-accent">quiet</span>');
    expect(html).toContain('href="/products"');
    expect(html).toContain('href="/about"');
  });

  it("keeps the compact hero heading neutral", () => {
    expect(render(<Hero src="" alt="" eyebrow="" heading="The *desk*" lead="" primaryLabel="" primaryHref="" secondaryLabel="" secondaryHref="" variant="compact" />)).not.toContain("text-shop-accent");
  });

  it("renders an image figure", () => {
    expect(render(<Image src="/a" alt="A" aspect="16/9" caption="Cap" />)).toContain("aspect-video");
  });

  it("renders prose markdown", () => {
    const html = render(<Prose markdown={"## Care\n\nWipe **dry**.\n\n- one\n- two"} />);
    expect(html).toContain("<h2");
    expect(html).toContain("<strong");
    expect(html).toContain("<li>two</li>");
  });

  it("groups FAQ items for one-open-at-a-time", () => {
    const html = render(<FaqAccordion allowMultiple={false} items={[<FaqItem question="Q1" answer="A1" order={1} />, <FaqItem question="Q2" answer="A2" order={2} />]} />);
    const names = [...html.matchAll(/<details name="([^"]+)"/g)].map((match) => match[1]);
    expect(names).toHaveLength(2);
    expect(names[0]).toBe(names[1]);
  });

  it("lets several FAQ items open when allowed", () => {
    expect(render(<FaqAccordion allowMultiple items={[<FaqItem question="Q" answer="A" order={0} />]} />)).not.toContain("name=");
  });
});
