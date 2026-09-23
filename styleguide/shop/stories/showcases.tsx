import { createElement, type ComponentChildren, type ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { StoryMeta } from "@takazudo/zudo-sg/stories";
import {
  AddToCart, Breadcrumbs, CartButton, CartPage, CartSummary, CategoryBody,
  CategoryTile, CheckoutForm, ContactForm, Container, DemoNote, FaqAccordion,
  FaqItem, Footer, GalleryImage, Grid, Header, Hero, Image, NavLink,
  Newsletter, Pagination, PriceTag, ProductCard, ProductGallery, ProductGrid,
  ProductHero, Prose, RelatedProducts, Section, SectionHeading, SpecTable,
  Split, Stack, StatusBadge, cartStore, componentPack,
} from "../src/generated/shop-pack";
import { assets } from "../src/generated/assets";

const photo = (name: string) => {
  const url = assets[name];
  if (!url) throw new Error(`Missing Shop asset: ${name}`);
  return url;
};
const notebook = photo("p-ledger-notebook.webp");
const notebookOpen = photo("p-ledger-notebook-2.webp");
const pen = photo("p-field-pen.webp");
const lamp = photo("p-wick-lamp.webp");
const hero = photo("shop-hero.webp");
const item = { slug: "ledger-notebook", name: "Ledger Notebook", price: 28, currency: "USD", src: notebook };
const seeded = { lines: [{ ...item, qty: 2 }] };

type Definition = {
  id: string;
  title: string;
  category: string;
  description: string;
  defaults: Record<string, unknown>;
  source: { exportName: string };
  component: ComponentType<Record<string, unknown>>;
};
const definitions = componentPack.manifest.components.map((entry) => ({
  ...entry,
  component: componentPack.runtime.components[entry.id]?.component,
})) as unknown as Definition[];

export function storyMeta(id: string): StoryMeta {
  const definition = definitions.find((entry) => entry.id === id);
  if (!definition) throw new Error(`Missing Shop pack component: ${id}`);
  return {
    title: definition.title,
    category: definition.category,
    description: definition.description,
    usage: `import { ${definition.source.exportName} } from "demo-webshop/components";\n\nconst props = ${JSON.stringify(definition.defaults, null, 2)};\n<${definition.source.exportName} {...props} />`,
  };
}

export function packDefaults(id: string): ComponentChildren {
  const definition = definitions.find((entry) => entry.id === id);
  if (!definition) throw new Error(`Missing Shop pack component: ${id}`);
  const preview = createElement(definition.component, { ...definition.defaults });
  return /shop\.(cart-|add-to-cart|checkout-form)/.test(id)
    ? <CartSession fill={false}>{preview}</CartSession>
    : preview;
}

function CartSession({ children, fill = true }: { children: ComponentChildren; fill?: boolean }) {
  useEffect(() => {
    cartStore.set(fill ? seeded : { lines: [] });
    const clear = () => cartStore.clear();
    addEventListener("pagehide", clear);
    return () => {
      removeEventListener("pagehide", clear);
      clear();
    };
  }, [fill]);
  return <>{children}</>;
}

function PaginationDemo({ initial }: { initial: number }) {
  const [page, setPage] = useState(initial);
  return <Pagination page={page} pageCount={4} onPage={setPage} />;
}

const productCards = () => [
  <ProductCard key="ledger" {...{ name: "Ledger Notebook", href: "#ledger", src: notebook, alt: "Linen notebook", price: 28, currency: "USD", category: "desk" as const, availability: "in-stock" as const, stockLabel: "In stock", slug: "ledger-notebook", featured: true, tag1: "paper", tag2: "notebook", tag3: "" }} />,
  <ProductCard key="pen" {...{ name: "Field Pen", href: "#pen", src: pen, alt: "Black fountain pen", price: 42, currency: "USD", category: "desk" as const, availability: "low-stock" as const, stockLabel: "Only a few left", slug: "field-pen", featured: false, tag1: "writing", tag2: "pen", tag3: "" }} />,
  <ProductCard key="lamp" {...{ name: "Wick Lamp", href: "#lamp", src: lamp, alt: "Brass lamp", price: 76, currency: "USD", category: "light" as const, availability: "in-stock" as const, stockLabel: "In stock", slug: "wick-lamp", featured: true, tag1: "lamp", tag2: "", tag3: "" }} />,
];
const productGallery = () => <ProductGallery images={<><GalleryImage src={notebook} alt="Closed charcoal notebook" /><GalleryImage src={notebookOpen} alt="Open dotted notebook" /></>} />;
const note = () => <DemoNote text="This is the demo shop. No payment or message is sent." />;

export function showcase(id: string, example: boolean): ComponentChildren {
  const definition = definitions.find((entry) => entry.id === id);
  if (!definition) throw new Error(`Missing Shop pack component: ${id}`);
  const render = (props: Record<string, unknown> = {}) => createElement(definition.component, { ...definition.defaults, ...props });
  switch (id) {
    case "shop.header": return <Header brand={example ? "Nightjar Supply / Studio" : "Nightjar Supply"} brandHref="#home" nav={<><NavLink label="All objects" href="#products" /><NavLink label="About" href="#about" /></>} actions={<CartButton label="Cart" href="#cart" />} />;
    case "shop.nav-link": return <NavLink label={example ? "About Nightjar" : "All objects"} href="#products" exact={example} />;
    case "shop.cart-button": return <CartSession><CartButton label={example ? "Your cart" : "Cart"} href="#cart" /></CartSession>;
    case "shop.footer": return <Footer smallPrint="Nightjar Supply is a demo shop. Nothing here is for sale." creditLabel="Built with zudo-composer" creditHref="https://github.com/Takazudo/zudo-composer" nav={<><NavLink label="Catalog" href="#products" /><NavLink label="Contact" href="#contact" /></>} />;
    case "shop.breadcrumbs": return <Breadcrumbs items={example ? [{ label: "Home", href: "#home" }, { label: "Desk", href: "#desk" }, { label: "Ledger Notebook", href: "#notebook" }] : [{ label: "Home", href: "#home" }, { label: "All objects", href: "#products" }]} />;
    case "shop.demo-note": return example ? note() : render();
    case "shop.container": return <Container width={example ? "prose" : "page"}><SectionHeading eyebrow="Nightjar Supply" heading="Considered objects" intro="Small essentials for desk, carry and light." as="h2" /></Container>;
    case "shop.category-body": return <CategoryBody><SectionHeading eyebrow="Desk" heading="Tools for focused work" intro="Made for the hours that matter." as="h2" /><ProductGrid toolbar={false} chips={false} pageSize={8} defaultSort="featured" emptyText="No products match." items={productCards()} /></CategoryBody>;
    case "shop.stack": return <Stack gap={example ? "lg" : "md"} align="stretch"><SectionHeading heading="A quiet shelf" eyebrow="Desk" intro="Objects to use every day." as="h2" />{note()}</Stack>;
    case "shop.grid": return <Grid columns={example ? "2" : "3"} gap="md" items={productCards()} />;
    case "shop.split": return <Split ratio={example ? "3/2" : "1/1"} left={<Image src={notebook} alt="Ledger Notebook" aspect="1/1" caption="Linen cover" />} right={<Prose markdown="## Ledger Notebook\n\nA place for notes, lists and ideas." />} />;
    case "shop.section": return <Section tone={example ? "surface" : "bg"}><SectionHeading eyebrow="Objects" heading="Made to last" intro="Thoughtful essentials, quietly designed." as="h2" /></Section>;
    case "shop.section-heading": return <SectionHeading eyebrow="Desk objects" heading={example ? "Write it down" : "Considered objects"} intro="Useful things for daily rituals." as="h2" />;
    case "shop.product-grid": return <ProductGrid toolbar={example} chips={example} pageSize={2} defaultSort="featured" emptyText="No matching objects." items={productCards()} />;
    case "shop.product-card": return example ? productCards()[1] : productCards()[0];
    case "shop.category-tile": return <CategoryTile label={example ? "Light" : "Desk"} href="#category" src={example ? lamp : notebook} alt={example ? "Brass lamp" : "Linen notebook"} caption="Objects for the everyday" />;
    case "shop.status-badge": return <StatusBadge availability={example ? "low-stock" : "in-stock"} label={example ? "Only a few left" : "In stock"} />;
    case "shop.price-tag": return <PriceTag price={example ? 76 : 28} currency="USD" size={example ? "h2" : "body"} />;
    case "shop.pagination": return <PaginationDemo initial={example ? 2 : 1} />;
    case "shop.hero": return <Hero src={hero} alt="A dark workbench with a lit lamp" eyebrow="Nightjar Supply" heading={example ? "Objects for *quiet work*" : "Objects for quiet work"} lead="Considered objects for the desk and beyond." primaryLabel="Explore objects" primaryHref="#products" secondaryLabel="Our story" secondaryHref="#about" variant={example ? "compact" : "display"} />;
    case "shop.image": return <Image src={example ? lamp : notebook} alt={example ? "Brass lamp" : "Ledger Notebook"} aspect={example ? "16/9" : "4/3"} caption={example ? "Wick Lamp" : "Charcoal linen cover"} />;
    case "shop.prose": return <Prose markdown={example ? "## Materials\n\nA **linen cover** and *dotted pages* for everyday ideas.\n\n- 192 pages\n- Lay flat binding" : "A small collection of **useful things** for quiet work."} />;
    case "shop.faq-accordion": return <FaqAccordion allowMultiple={example} items={<><FaqItem question="Do you ship internationally?" answer="This is a demo shop; **nothing ships**." order={0} /><FaqItem question="Can I return an item?" answer="No purchases are made here." order={1} /></>} />;
    case "shop.faq-item": return <FaqItem question={example ? "How is the notebook made?" : "Do you ship?"} answer={example ? "The cover is **linen** and the paper is dotted." : "This is a demo shop; nothing ships."} order={0} />;
    case "shop.product-hero": return <ProductHero ratio={example ? "3/2" : "1/1"} media={productGallery()} copy={<><SectionHeading eyebrow="Desk" heading="Ledger Notebook" intro="A place for the work worth keeping." as="h2" /><PriceTag price={28} currency="USD" size="h2" /><CartSession fill={false}><AddToCart {...item} availability="in-stock" maxQuantity={10} /></CartSession></>} />;
    case "shop.product-gallery": return productGallery();
    case "shop.gallery-image": return <GalleryImage src={example ? notebookOpen : notebook} alt={example ? "Open notebook" : "Closed notebook"} />;
    case "shop.spec-table": return <SpecTable spec1Label="Material" spec1Value="Linen and paper" spec2Label="Dimensions" spec2Value="A5" spec3Label="Weight" spec3Value={example ? "240 g" : ""} spec4Label="Origin" spec4Value="Japan" spec5Label="Care" spec5Value="Keep dry" spec6Label="Warranty" spec6Value="" />;
    case "shop.add-to-cart": return <CartSession fill={false}><AddToCart {...item} availability={example ? "sold-out" : "in-stock"} maxQuantity={10} /></CartSession>;
    case "shop.related-products": return <RelatedProducts heading="You may also like" limit={example ? 2 : 3} items={productCards()} />;
    case "shop.cart-page": return <CartSession fill={example}><CartPage emptyText="Your cart is empty." emptyHref="#products" /></CartSession>;
    case "shop.cart-summary": return <CartSession fill={example}><CartSummary shipping={8} currency="USD" checkoutHref="#checkout" readOnly={!example} /></CartSession>;
    case "shop.checkout-form": return <CartSession fill={example}><CheckoutForm heading={example ? "Complete your mock order" : "Shipping and payment"} successHeading="Order placed" successText="No charge was made; this is a demo." /></CartSession>;
    case "shop.newsletter": return <Newsletter heading={example ? "Notes from Nightjar" : "Letters from the shelf"} lead="One short note when something new arrives." buttonLabel="Subscribe" />;
    case "shop.contact-form": return <ContactForm heading={example ? "Ask us a question" : "Write to us"} successText="Thanks. This is a demo; your message was not sent." />;
    default: return render();
  }
}
