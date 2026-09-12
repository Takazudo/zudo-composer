// This host's component pack. `pack` and every `source.module` are
// "demo-webshop/components": the package's own name plus an exported subpath,
// which Node and Vite both resolve without anything installed.
import { defineComponentPack } from "@zudo-composer/component-contract";
import { breadcrumbsComponent } from "./breadcrumbs";
import { cartButtonComponent } from "./cart-button";
import { categoryTileComponent } from "./category-tile";
import { containerComponent } from "./container";
import { demoNoteComponent } from "./demo-note";
import { faqAccordionComponent } from "./faq-accordion";
import { faqItemComponent } from "./faq-item";
import { footerComponent } from "./footer";
import { gridComponent } from "./grid";
import { headerComponent } from "./header";
import { heroComponent } from "./hero";
import { imageComponent } from "./image";
import { navLinkComponent } from "./nav-link";
import { paginationComponent } from "./pagination";
import { priceTagComponent } from "./price-tag";
import { productCardComponent } from "./product-card";
import { productGridComponent } from "./product-grid";
import { proseComponent } from "./prose";
import { sectionComponent } from "./section";
import { sectionHeadingComponent } from "./section-heading";
import { splitComponent } from "./split";
import { stackComponent } from "./stack";
import { statusBadgeComponent } from "./status-badge";

export const componentPack = defineComponentPack({
  packId: "demo-webshop",
  packVersion: "1.0.0",
  components: [
    headerComponent,
    navLinkComponent,
    cartButtonComponent,
    footerComponent,
    breadcrumbsComponent,
    demoNoteComponent,
    containerComponent,
    stackComponent,
    gridComponent,
    splitComponent,
    sectionComponent,
    sectionHeadingComponent,
    productGridComponent,
    productCardComponent,
    categoryTileComponent,
    statusBadgeComponent,
    priceTagComponent,
    paginationComponent,
    heroComponent,
    imageComponent,
    proseComponent,
    faqAccordionComponent,
    faqItemComponent,
  ],
});

export { Breadcrumbs } from "./breadcrumbs";
export { CartButton } from "./cart-button";
export { CategoryTile } from "./category-tile";
export { Container } from "./container";
export { DemoNote } from "./demo-note";
export { FaqAccordion } from "./faq-accordion";
export { FaqItem } from "./faq-item";
export { Footer } from "./footer";
export { Grid } from "./grid";
export { Header } from "./header";
export { Hero } from "./hero";
export { Image } from "./image";
export { NavLink } from "./nav-link";
export { Pagination } from "./pagination";
export { PriceTag } from "./price-tag";
export { ProductCard } from "./product-card";
export { ProductGrid } from "./product-grid";
export { Prose } from "./prose";
export { Section } from "./section";
export { SectionHeading } from "./section-heading";
export { Split } from "./split";
export { Stack } from "./stack";
export { StatusBadge } from "./status-badge";
export { cartStore, createCartStore, useCart, CART_STORAGE_KEY, type CartLine, type CartState } from "./cart-store";
