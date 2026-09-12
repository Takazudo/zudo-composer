// This host's component pack. `pack` and every `source.module` are
// "demo-webshop/components": the package's own name plus an exported subpath,
// which Node and Vite both resolve without anything installed.
import { defineComponentPack } from "@zudo-composer/component-contract";
import { addToCartComponent } from "./add-to-cart";
import { breadcrumbsComponent } from "./breadcrumbs";
import { cartButtonComponent } from "./cart-button";
import { cartPageComponent } from "./cart-page";
import { cartSummaryComponent } from "./cart-summary";
import { categoryTileComponent } from "./category-tile";
import { checkoutFormComponent } from "./checkout-form";
import { contactFormComponent } from "./contact-form";
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
import { newsletterComponent } from "./newsletter";
import { paginationComponent } from "./pagination";
import { priceTagComponent } from "./price-tag";
import { productCardComponent } from "./product-card";
import { productGalleryComponent } from "./product-gallery";
import { productGridComponent } from "./product-grid";
import { productHeroComponent } from "./product-hero";
import { proseComponent } from "./prose";
import { relatedProductsComponent } from "./related-products";
import { sectionComponent } from "./section";
import { sectionHeadingComponent } from "./section-heading";
import { specTableComponent } from "./spec-table";
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
    productHeroComponent,
    productGalleryComponent,
    specTableComponent,
    addToCartComponent,
    relatedProductsComponent,
    cartPageComponent,
    cartSummaryComponent,
    checkoutFormComponent,
    newsletterComponent,
    contactFormComponent,
  ],
});

export { AddToCart } from "./add-to-cart";
export { Breadcrumbs } from "./breadcrumbs";
export { CartButton } from "./cart-button";
export { CartPage } from "./cart-page";
export { CartSummary } from "./cart-summary";
export { CategoryTile } from "./category-tile";
export { CheckoutForm } from "./checkout-form";
export { ContactForm } from "./contact-form";
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
export { Newsletter } from "./newsletter";
export { Pagination } from "./pagination";
export { PriceTag } from "./price-tag";
export { ProductCard } from "./product-card";
export { ProductGallery } from "./product-gallery";
export { ProductGrid } from "./product-grid";
export { ProductHero } from "./product-hero";
export { Prose } from "./prose";
export { RelatedProducts } from "./related-products";
export { Section } from "./section";
export { SectionHeading } from "./section-heading";
export { SpecTable } from "./spec-table";
export { Split } from "./split";
export { Stack } from "./stack";
export { StatusBadge } from "./status-badge";
export { cartStore, createCartStore, useCart, CART_STORAGE_KEY, type CartLine, type CartState } from "./cart-store";
