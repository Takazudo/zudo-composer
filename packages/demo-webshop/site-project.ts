// The authored site. `zudo-composer generate` turns this into `site-project.json`;
// `zudo-composer generate --check` reports when the committed output disagrees.
import { defineSite, entryRef, node } from "zudo-composer/authoring";
import type { BindingInput, Entry, JsonObject, Model, RouteInput } from "zudo-composer/site-project";
import { componentPack } from "./components/pack";

const site = defineSite({ id: "demo-webshop", name: "Nightjar Supply", componentPack });

// Asset record ids in the committed cms/assets store (seeded from images-src/manifest.json).
const ASSET_IDS = {
  "shop-hero": "assets-b8badec4-c972-48f8-9944-b44d671723cc",
  "p-ledger-notebook": "assets-449340b8-78fd-4646-97e1-20cbb6949a87",
  "p-ledger-notebook-2": "assets-ab894c50-574e-4341-b5a8-709e8e9a68f7",
  "p-brass-rule": "assets-6282f007-ca3b-4fb4-bfe8-589e6524b099",
  "p-field-pen": "assets-58a10ab3-1341-4693-bd6a-ca94c766fd4f",
  "p-field-pen-2": "assets-3e8d2ee4-42db-4b78-9374-3c715606f1e6",
  "p-slate-tray": "assets-84599af4-0d54-4bbb-bae1-a4c74ccea928",
  "p-sling-pouch": "assets-27d2cd6e-0874-455b-91a5-784bf79c8d14",
  "p-card-wallet": "assets-eba643be-cd55-48f9-b7ce-7290ce2062d0",
  "p-key-loop": "assets-728d3d8d-1951-4baf-b65f-4f231afc24be",
  "p-rain-cape": "assets-e6a710b3-480d-4b62-8e8b-da45c4f29cd7",
  "p-wick-lamp": "assets-7e6a524b-3b9a-4f89-a763-6949cd5c84bc",
  "p-wick-lamp-2": "assets-14a1881b-90d9-4abc-9589-e887be624154",
  "p-pocket-torch": "assets-30c8b3fb-2b3e-4d39-94df-5f2616f4882d",
  "p-candle-set": "assets-29940c85-15d2-4c6e-bcce-2233d97bb497",
  "p-clip-light": "assets-98de0939-961d-42d1-b195-dac35fc4586b",
} as const;

type ImageName = keyof typeof ASSET_IDS;
const assetUrl = (name: ImageName) => `/uploaded-assets/asset-${ASSET_IDS[name]}`;

const HERO_ALT = "A dark workbench at night with a small lit brass lamp, a closed notebook and a pen";

// ---------------------------------------------------------------- models

const image = (key: string, required = true) => ({
  key,
  kind: "object" as const,
  required,
  fields: [{ key: "src", kind: "url" as const }, { key: "alt", kind: "text" as const }],
});

const categories = site.model({
  name: "Categories",
  kind: "collection",
  description: "The three shelves of the shop.",
  fields: [
    { key: "name", kind: "text" },
    { key: "slug", kind: "slug" },
    { key: "order", kind: "number" },
    { key: "intro", kind: "long-text" },
    { key: "caption", kind: "text" },
    image("image"),
  ],
});

type StockLabel = "In stock" | "Only a few left" | "Sold out" | "Ships in 2 weeks";

// `availability` and `stockLabel` are text rather than choice: a choice value
// cannot be bound to any component prop (src/mapping/resolver/compatibility.ts).
// `tag1`–`tag3` flatten `tags` for the card's search data (README § Lists).
const products = site.model({
  name: "Products",
  kind: "collection",
  description: "Twelve objects for quiet work.",
  fields: [
    { key: "name", kind: "text" },
    { key: "slug", kind: "slug" },
    { key: "subtitle", kind: "text" },
    { key: "description", kind: "markdown" },
    { key: "price", kind: "number" },
    { key: "currency", kind: "text" },
    { key: "availability", kind: "text" },
    { key: "stockLabel", kind: "text" },
    { key: "tags", kind: "list", item: { kind: "text" } },
    { key: "tag1", kind: "text", required: false },
    { key: "tag2", kind: "text", required: false },
    { key: "tag3", kind: "text", required: false },
    {
      key: "spec",
      kind: "object",
      fields: ["material", "dimensions", "weight", "origin", "care", "warranty"].map((key) => ({ key, kind: "text" as const })),
    },
    image("image1"),
    image("image2", false),
    { key: "featured", kind: "boolean" },
    { key: "category", kind: "reference", target: categories },
  ],
});
const faq = site.model({
  name: "FAQ",
  id: "faq",
  kind: "collection",
  fields: [
    { key: "question", kind: "text" },
    { key: "answer", kind: "markdown" },
    { key: "order", kind: "number" },
  ],
});

const about = site.model({
  name: "About",
  kind: "single",
  fields: [
    { key: "heading", kind: "text" },
    { key: "intro", kind: "long-text" },
    { key: "body", kind: "markdown" },
  ],
});

const imageValue = (name: ImageName, alt: string): JsonObject => ({ src: assetUrl(name), alt });

// ---------------------------------------------------------------- categories

const categoryEntries: Record<string, Entry> = {};
for (const category of [
  {
    id: "desk",
    name: "Desk",
    order: 1,
    intro: "Paper, brass and stone for the surface you work on. Tools that stay where you put them and get better with handling.",
    caption: "Four objects for the surface you work on",
    image: ["p-ledger-notebook", "Charcoal linen A5 notebook with a black elastic band"],
  },
  {
    id: "carry",
    name: "Carry",
    order: 2,
    intro: "Small goods for the walk between places. Waxed canvas, full-grain leather and nothing that rattles.",
    caption: "Four objects for the walk between places",
    image: ["p-sling-pouch", "Small black waxed-canvas sling pouch"],
  },
  {
    id: "light",
    name: "Light",
    order: 3,
    intro: "Low, warm light for late work. A lamp for the desk, a torch for the pocket, candles for the evening after.",
    caption: "Four lights for late work",
    image: ["p-wick-lamp", "Small lit brass oil lamp with a glass chimney"],
  },
] as const) {
  categoryEntries[category.id] = site.entry(categories, {
    id: category.id,
    values: {
      name: category.name,
      slug: category.id,
      order: category.order,
      intro: category.intro,
      caption: category.caption,
      image: imageValue(category.image[0], category.image[1]),
    },
  });
}

// ---------------------------------------------------------------- products

interface ProductInput {
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  price: number;
  category: "desk" | "carry" | "light";
  availability: "in-stock" | "low-stock" | "sold-out";
  stockLabel: StockLabel;
  featured: boolean;
  tags: string[];
  spec: { material: string; dimensions: string; weight: string; origin: string; care: string; warranty: string };
  image1: [ImageName, string];
  image2?: [ImageName, string];
}

const PRODUCTS: ProductInput[] = [
  {
    slug: "ledger-notebook",
    name: "Ledger Notebook A5",
    subtitle: "Linen-bound, dotted, and flat on the first page.",
    description:
      "A hardcover A5 notebook bound in charcoal book linen, with 192 pages of 90 gsm ivory paper printed with a faint 5 mm dot grid. The paper takes fountain pen ink without feathering and shows only a ghost of it on the reverse.\n\nThe spine is sewn in signatures, so the book opens flat from the first page to the last. A black elastic band keeps it shut in a bag, and a rear pocket holds loose receipts and the odd pressed leaf.\n\nWe number every page and leave two blank for an index, because the notes you need most are the ones you wrote three months ago.",
    price: 24,
    category: "desk",
    availability: "in-stock",
    stockLabel: "In stock",
    featured: true,
    tags: ["paper", "notebook", "writing"],
    spec: {
      material: "Book linen over board; 90 gsm ivory paper",
      dimensions: "148 × 210 × 16 mm, 192 pages",
      weight: "340 g",
      origin: "Bound in Porto, Portugal",
      care: "Keep dry; wipe the cover with a dry cloth",
      warranty: "Replaced if the binding fails",
    },
    image1: ["p-ledger-notebook", "Charcoal linen A5 notebook with a black elastic band"],
    image2: ["p-ledger-notebook-2", "The notebook open to blank dotted pages"],
  },
  {
    slug: "brass-rule",
    name: "Brass Rule 30 cm",
    subtitle: "Solid brass, engraved millimetres, heavy enough to hold a page.",
    description:
      "A 30 cm straightedge milled from a single bar of solid brass, with millimetre and centimetre marks cut into the face rather than printed on it. The marks will outlast the desk.\n\nAt nearly 200 g the rule stays put when you draw against it and holds a book open at the page you are copying from. The edges are broken by hand so it is kind to fingers and paper.\n\nLeft alone, the brass darkens to a soft brown within a season. Rub it with a cloth and a little polish if you prefer it bright.",
    price: 38,
    category: "desk",
    availability: "in-stock",
    stockLabel: "In stock",
    featured: false,
    tags: ["brass", "drawing", "measure"],
    spec: {
      material: "Solid C360 brass",
      dimensions: "320 × 25 × 3 mm",
      weight: "195 g",
      origin: "Machined in Osaka, Japan",
      care: "Let it patina, or polish with a soft cloth",
      warranty: "Lifetime against manufacturing faults",
    },
    image1: ["p-brass-rule", "Solid brass 30 cm ruler with engraved marks"],
  },
  {
    slug: "field-pen",
    name: "Field Pen",
    subtitle: "A machined aluminium fountain pen that posts, clips and travels.",
    description:
      "A short fountain pen turned from aircraft aluminium and finished in a matte black anodise that will not show fingerprints. Capped, it fits a shirt pocket; posted, it balances like a full-size pen.\n\nThe steel nib is a medium-fine that writes wet enough for good paper and dry enough for cheap paper. It takes standard international cartridges or the included converter, so you are never far from ink.\n\nThe cap threads on in one and a half turns and seals well enough to leave in a bag for a month without drying out.",
    price: 42,
    category: "desk",
    availability: "low-stock",
    stockLabel: "Only a few left",
    featured: true,
    tags: ["pen", "writing", "aluminium"],
    spec: {
      material: "6061 aluminium body; stainless steel nib",
      dimensions: "118 mm capped, 145 mm posted, 12 mm diameter",
      weight: "22 g",
      origin: "Machined in Taichung, Taiwan",
      care: "Flush with cool water between ink colours",
      warranty: "Two years; nibs replaced free for the first year",
    },
    image1: ["p-field-pen", "Matte black aluminium fountain pen, capped"],
    image2: ["p-field-pen-2", "The pen uncapped, showing its steel nib"],
  },
  {
    slug: "slate-tray",
    name: "Slate Desk Tray",
    subtitle: "A shallow tray of honed slate for the small things on a desk.",
    description:
      "Cut from a single piece of dark Welsh slate and honed to a soft matte face, this tray gives paper clips, keys and a watch somewhere to live that is not the middle of your desk.\n\nThe floor is sunk 8 mm, just enough to stop things rolling off, and the underside carries four cork feet so the stone never scratches wood.\n\nNo two trays are quite the same colour. Some carry a faint grey seam through the stone, which we consider a feature.",
    price: 56,
    category: "desk",
    availability: "in-stock",
    stockLabel: "In stock",
    featured: false,
    tags: ["stone", "storage", "tray"],
    spec: {
      material: "Honed Welsh slate; cork feet",
      dimensions: "240 × 120 × 18 mm",
      weight: "820 g",
      origin: "Cut in Blaenau Ffestiniog, Wales",
      care: "Wipe with a damp cloth; a drop of oil deepens the colour",
      warranty: "Replaced if it arrives chipped",
    },
    image1: ["p-slate-tray", "Shallow dark slate desk tray holding two paper clips"],
  },
  {
    slug: "sling-pouch",
    name: "Sling Pouch",
    subtitle: "Waxed canvas, one buckle, and room for exactly what you need.",
    description:
      "A small cross-body pouch in black waxed cotton canvas that sheds rain and softens with use. It carries a phone, a wallet, keys and a notebook, and refuses anything more, which is the point.\n\nThe strap adjusts through a matte steel buckle and sits flat against the body. Inside, one slip pocket keeps cards apart from keys.\n\nThe wax wears in where you touch it. Re-wax once a year and the canvas will keep its shape for a decade.",
    price: 64,
    category: "carry",
    availability: "in-stock",
    stockLabel: "In stock",
    featured: true,
    tags: ["canvas", "bag", "everyday"],
    spec: {
      material: "Waxed cotton canvas; leather trim; steel buckle",
      dimensions: "220 × 150 × 60 mm, strap 70–130 cm",
      weight: "280 g",
      origin: "Sewn in Leicester, England",
      care: "Brush off dirt; re-wax once a year",
      warranty: "Five years on seams and hardware",
    },
    image1: ["p-sling-pouch", "Small black waxed-canvas sling pouch"],
  },
  {
    slug: "card-wallet",
    name: "Card Wallet",
    subtitle: "Two pockets, one fold of leather, six cards at most.",
    description:
      "A slim card wallet cut from black full-grain leather and stitched with waxed linen thread. It holds up to six cards and a folded note, and it still slips into a front pocket without a bulge.\n\nThe leather is vegetable tanned, so it darkens and takes a polish with use rather than cracking. Edges are burnished by hand.\n\nWe make it in one size because we tried three and everyone chose this one.",
    price: 58,
    category: "carry",
    availability: "in-stock",
    stockLabel: "In stock",
    featured: false,
    tags: ["leather", "wallet", "everyday"],
    spec: {
      material: "Vegetable-tanned full-grain leather; waxed linen thread",
      dimensions: "105 × 75 × 6 mm",
      weight: "38 g",
      origin: "Stitched in Florence, Italy",
      care: "Condition twice a year with a neutral balm",
      warranty: "Five years on stitching",
    },
    image1: ["p-card-wallet", "Slim black leather card wallet"],
  },
  {
    slug: "key-loop",
    name: "Key Loop",
    subtitle: "A leather loop and a blackened ring that keep keys quiet.",
    description:
      "A short loop of black bridle leather riveted around a blackened steel split ring. It hangs from a belt loop or a bag strap and keeps your keys from scratching everything else in the pocket.\n\nThe ring opens with a thumbnail and holds up to eight keys. The rivet is solid copper, peened by hand, and will not work loose.\n\nA small thing, but the one you touch most days.",
    price: 22,
    category: "carry",
    availability: "low-stock",
    stockLabel: "Only a few left",
    featured: false,
    tags: ["leather", "keys", "everyday"],
    spec: {
      material: "Bridle leather; blackened steel; copper rivet",
      dimensions: "95 × 18 mm, ring 25 mm",
      weight: "18 g",
      origin: "Made in Walsall, England",
      care: "Condition the leather when it looks dry",
      warranty: "Five years",
    },
    image1: ["p-key-loop", "Black leather key loop with a dark steel ring"],
  },
  {
    slug: "rain-cape",
    name: "Packable Rain Cape",
    subtitle: "A charcoal cape that folds into its own sack and covers a bag.",
    description:
      "A lightweight cape in charcoal ripstop nylon with a 10,000 mm waterproof coating and taped seams. It is cut long and wide enough to cover you and a bag on your back, and it vents at the sides so you do not boil in it.\n\nPacked, it rolls into a stuff sack the size of a coffee cup. A hood with a stiffened brim keeps rain off glasses.\n\nThe first run sold through in a week. The next arrives in the autumn.",
    price: 96,
    category: "carry",
    availability: "sold-out",
    stockLabel: "Sold out",
    featured: false,
    tags: ["rain", "outerwear", "travel"],
    spec: {
      material: "Recycled ripstop nylon, PU coated; taped seams",
      dimensions: "One size; 110 cm back length",
      weight: "310 g with sack",
      origin: "Made in Busan, South Korea",
      care: "Rinse and hang to dry; do not tumble",
      warranty: "Two years on seams and coating",
    },
    image1: ["p-rain-cape", "Folded charcoal rain cape beside its stuff sack"],
  },
  {
    slug: "wick-lamp",
    name: "Wick Lamp",
    subtitle: "A small brass oil lamp with a glass chimney and a steady flame.",
    description:
      "A small table lamp spun from brass with a hand-blown glass chimney. It burns lamp oil through a flat cotton wick and gives about the light of two candles, steady and warm, for eight hours on one filling.\n\nA thumbwheel raises and lowers the wick, so you can turn it down to a glow at the end of the evening. The wide base will not tip on a desk.\n\nIt is the lamp in the photograph at the top of this shop, and the one we work by after dark.",
    price: 148,
    category: "light",
    availability: "in-stock",
    stockLabel: "In stock",
    featured: true,
    tags: ["brass", "lamp", "oil"],
    spec: {
      material: "Spun brass; borosilicate glass chimney; cotton wick",
      dimensions: "110 mm base, 240 mm tall with chimney",
      weight: "610 g",
      origin: "Spun in Moradabad, India",
      care: "Trim the wick flat; burn only clear lamp oil",
      warranty: "Three years; chimneys replaced at cost",
    },
    image1: ["p-wick-lamp", "Small lit brass oil lamp with a glass chimney"],
    image2: ["p-wick-lamp-2", "The brass lamp unlit with its chimney set beside it"],
  },
  {
    slug: "pocket-torch",
    name: "Pocket Torch",
    subtitle: "A short aluminium torch with one button and two brightnesses.",
    description:
      "A pocket torch turned from black anodised aluminium, no longer than a key. One click gives a soft 30 lumen light for reading a map; a second gives 300 lumens for finding the path.\n\nIt charges over USB-C in an hour and runs for a week of evening walks on one charge. The lens is frosted, so the beam is even rather than a hot spot.\n\nThe tail stands flat, so it can point at the ceiling and light a small room.",
    price: 46,
    category: "light",
    availability: "in-stock",
    stockLabel: "In stock",
    featured: false,
    tags: ["torch", "aluminium", "travel"],
    spec: {
      material: "Anodised 6061 aluminium; frosted polycarbonate lens",
      dimensions: "72 × 18 mm",
      weight: "34 g",
      origin: "Assembled in Shenzhen, China",
      care: "Keep the port dry; charge every few months in storage",
      warranty: "Two years, battery included",
    },
    image1: ["p-pocket-torch", "Short black aluminium pocket flashlight"],
  },
  {
    slug: "candle-set",
    name: "Candle Set",
    subtitle: "Three unscented ivory pillars in three heights.",
    description:
      "Three pillar candles poured from a blend of rapeseed and beeswax, in 7, 10 and 13 cm heights. They are unscented, so they sit quietly beside dinner and do not argue with coffee.\n\nThe wax burns clean and slowly, about 40 hours for the tallest. Cotton wicks are pre-trimmed and stay centred to the end.\n\nThey arrive wrapped in paper, not plastic, in a box you can keep them in between evenings.",
    price: 28,
    category: "light",
    availability: "in-stock",
    stockLabel: "In stock",
    featured: false,
    tags: ["candle", "wax", "evening"],
    spec: {
      material: "Rapeseed and beeswax blend; cotton wicks",
      dimensions: "60 mm diameter; 70, 100 and 130 mm tall",
      weight: "780 g the set",
      origin: "Poured in Ghent, Belgium",
      care: "Trim wicks to 5 mm; never leave burning unattended",
      warranty: "Replaced if a wick fails",
    },
    image1: ["p-candle-set", "Three ivory pillar candles of different heights"],
  },
  {
    slug: "clip-light",
    name: "Clip Reading Light",
    subtitle: "A small clip-on light with a flexible neck for books and bunks.",
    description:
      "A reading light that clips to a book cover, a shelf or the edge of a bunk and bends its neck to where the page is. The warm 2700 K light is dimmable in three steps and never glares off paper.\n\nThe clip is lined with soft silicone so it will not mark a cover. It charges over USB-C and lasts twenty evenings of an hour each.\n\nThis batch is gone. We are waiting on new clips that grip thicker shelves.",
    price: 34,
    category: "light",
    availability: "sold-out",
    stockLabel: "Ships in 2 weeks",
    featured: false,
    tags: ["reading", "lamp", "travel"],
    spec: {
      material: "ABS body; silicone-lined clip; steel gooseneck",
      dimensions: "Clip 45 mm; neck 220 mm",
      weight: "68 g",
      origin: "Assembled in Dongguan, China",
      care: "Wipe clean; avoid bending the neck past 90°",
      warranty: "One year",
    },
    image1: ["p-clip-light", "Small black clip-on reading light"],
  },
];

for (const product of PRODUCTS) {
  const [tag1 = "", tag2 = "", tag3 = ""] = product.tags;
  site.entry(products, {
    id: product.slug,
    values: {
      name: product.name,
      slug: product.slug,
      subtitle: product.subtitle,
      description: product.description,
      price: product.price,
      currency: "USD",
      availability: product.availability,
      stockLabel: product.stockLabel,
      tags: product.tags,
      tag1,
      tag2,
      tag3,
      spec: { ...product.spec },
      image1: imageValue(...product.image1),
      ...(product.image2 ? { image2: imageValue(...product.image2) } : {}),
      featured: product.featured,
      category: entryRef(categoryEntries[product.category]!),
    },
  });
}

// ---------------------------------------------------------------- FAQ and about

const FAQ = [
  ["Is this a real shop?", "No. Nightjar Supply is a demo site built with [zudo-composer](https://github.com/Takazudo/zudo-composer). Nothing is for sale, nothing ships and no payment is ever taken."],
  ["What happens when I check out?", "The checkout form checks what you type, waits a moment and shows a made-up order number. Your cart is then emptied. **No data leaves your browser.**"],
  ["Where is my cart kept?", "In your browser's local storage, under one key. Clear your site data and the cart is gone. There is no account and no server-side basket."],
  ["How much is shipping?", "In this demo, a flat 8 USD on every order, shown in the cart summary. A real shop would quote by weight and destination."],
  ["Can I return something?", "There is nothing to return. If this were a real shop, we would offer thirty days on anything unused, with a prepaid label."],
  ["Why do some products say sold out?", "Two products are marked sold out so the demo can show how the shop behaves when stock runs out: the badge changes and the add-to-cart button is disabled."],
  ["Are the photographs real?", "They are stylised illustrations made for this demo. Every product, maker and place name here is invented."],
  ["How was this site built?", "Every page is a Composer composition. Products, categories and these questions are Content entries, bound to components through Mappings and placed in a Sitemapper tree."],
] as const;

FAQ.forEach(([question, answer], index) => {
  site.entry(faq, { id: `faq-${index + 1}`, values: { question, answer, order: index + 1 } });
});

site.entry(about, {
  id: "about",
  values: {
    heading: "About Nightjar Supply",
    intro: "A small shop for the hours after everyone else has gone home.",
    body:
      "## Twelve objects, no more\n\nNightjar Supply started with a lamp, a notebook and a pen on a workbench late at night. We wanted a shop that sold only the things that earn their place on that bench: tools for writing, carrying and seeing by.\n\nEvery object here is made by a small workshop we have visited. We keep the range to twelve so we can know each one well, and we would rather sell out than fill the shelf with things we do not use ourselves.\n\n## How we choose\n\n- It must do one job well and be quiet about it.\n- It must get better with use, or at least not worse.\n- It must be repairable, refillable or built to outlast its warranty.\n\n## A demo, honestly\n\nThis shop is a demonstration of *zudo-composer*. The products, workshops and prices are invented, and the checkout sends nothing anywhere. The contact form below behaves the same way.",
  },
});

// ---------------------------------------------------------------- frame

const navLink = (label: string, href: string, exact = false) => node("shop.nav-link", { label, href, exact });

const frame = site.template({
  name: "Site frame",
  root: [
    node(
      "shop.header",
      { brand: "Nightjar Supply", brandHref: "/" },
      {
        nav: [navLink("Desk", "/desk"), navLink("Carry", "/carry"), navLink("Light", "/light"), navLink("All products", "/products"), navLink("About", "/about")],
        actions: [node("shop.cart-button", { label: "Cart", href: "/cart" })],
      },
      "frame-header",
    ),
    node("shop.container", { width: "page" }, {}, "frame-main"),
    node(
      "shop.footer",
      {
        smallPrint: "Nightjar Supply is a demo shop. Nothing here is for sale, and no data you enter is sent anywhere.",
        creditLabel: "Built with zudo-composer",
        creditHref: "https://github.com/Takazudo/zudo-composer",
      },
      { nav: [navLink("About", "/about"), navLink("FAQ", "/faq"), navLink("Cart", "/cart"), navLink("Checkout", "/checkout")] },
      "frame-footer",
    ),
  ],
  outlet: { target: { parentId: "frame-main", slotId: "content" } },
});

// ---------------------------------------------------------------- list items

const card = (field: string, prop: string, extra: Partial<BindingInput> = {}): BindingInput => ({ field, nodeId: "card", prop, ...extra });
const srcOf = (model: Model, key: string) => ({ kind: "object-field" as const, fieldIds: [`${model.fieldId(key)}-src`] });
const altOf = (model: Model, key: string) => ({ kind: "object-field" as const, fieldIds: [`${model.fieldId(key)}-alt`] });

const productCard = site.page({ name: "Product card", root: [node("shop.product-card", {}, {}, "card")] });
const productCards = site.mapping({
  name: "Product card",
  model: products,
  composition: productCard,
  mode: { kind: "collection", sort: [{ field: "name", direction: "asc" }] },
  bindings: [
    card("name", "name"),
    card("slug", "href", { transform: { kind: "prefix", prefix: "/products/" } }),
    card("slug", "slug"),
    card("image1", "src", { projection: srcOf(products, "image1"), id: "product-card-image1-src" }),
    card("image1", "alt", { projection: altOf(products, "image1"), id: "product-card-image1-alt" }),
    card("price", "price"),
    card("currency", "currency"),
    card("category", "category", { projection: { kind: "reference-id" } }),
    card("availability", "availability"),
    card("stockLabel", "stockLabel"),
    card("featured", "featured"),
    card("tag1", "tag1"),
    card("tag2", "tag2"),
    card("tag3", "tag3"),
  ],
});

// The same card composition, queried differently per list (README § Lists).
const productCardQuery = (name: string, mode: Parameters<typeof site.mapping>[0]["mode"]) =>
  site.mapping({ name, model: products, composition: productCard, mode, bindings: productCards.record.document.bindings.map(toBindingInput) });

function toBindingInput(binding: (typeof productCards.record.document.bindings)[number]): BindingInput {
  const key = products.record.document.fields.find((field) => field.id === binding.sourceFieldId)!.key;
  return { field: key, nodeId: binding.target.nodeId, prop: binding.target.prop, projection: binding.projection, transform: binding.transform };
}

const featuredCards = productCardQuery("Featured product cards", {
  kind: "collection",
  conditions: [{ field: "featured", operator: "equals", value: true }],
  sort: [{ field: "name", direction: "asc" }],
  limit: 4,
});
const categoryCards = Object.fromEntries(
  (["desk", "carry", "light"] as const).map((id) => [
    id,
    productCardQuery(`${categoryEntries[id]!.record.values[categories.fieldId("name")] as string} product cards`, {
      kind: "collection",
      conditions: [{ field: "category", operator: "equals", value: entryRef(categoryEntries[id]!) }],
      sort: [{ field: "name", direction: "asc" }],
    }),
  ]),
);

const categoryTile = site.page({ name: "Category tile", root: [node("shop.category-tile", {}, {}, "tile")] });
const categoryTiles = site.mapping({
  name: "Category tile",
  model: categories,
  composition: categoryTile,
  mode: { kind: "collection", sort: [{ field: "order", direction: "asc" }] },
  bindings: [
    { field: "name", nodeId: "tile", prop: "label" },
    { field: "slug", nodeId: "tile", prop: "href", transform: { kind: "prefix", prefix: "/" } },
    { field: "image", nodeId: "tile", prop: "src", projection: srcOf(categories, "image"), id: "category-tile-image-src" },
    { field: "image", nodeId: "tile", prop: "alt", projection: altOf(categories, "image"), id: "category-tile-image-alt" },
    { field: "caption", nodeId: "tile", prop: "caption" },
  ],
});

const faqItem = site.page({ name: "FAQ item", root: [node("shop.faq-item", {}, {}, "faq-item")] });
const faqItems = site.mapping({
  name: "FAQ item",
  model: faq,
  composition: faqItem,
  mode: { kind: "collection", sort: [{ field: "order", direction: "asc" }] },
  bindings: [
    { field: "question", nodeId: "faq-item", prop: "question" },
    { field: "answer", nodeId: "faq-item", prop: "answer" },
    { field: "order", nodeId: "faq-item", prop: "order" },
  ],
});

// ---------------------------------------------------------------- pages

const section = (id: string, content: ReturnType<typeof node>[], tone: "bg" | "surface" = "bg") => node("shop.section", { tone }, { content }, id);
const heading = (heading: string, options: { eyebrow?: string; intro?: string; as?: "h1" | "h2" } = {}, id?: string) =>
  node("shop.section-heading", { eyebrow: options.eyebrow ?? "", heading, intro: options.intro ?? "", as: options.as ?? "h2" }, {}, id);

const home = site.page({
  name: "Home",
  template: frame,
  root: [
    node("shop.hero", {
      src: assetUrl("shop-hero"),
      alt: HERO_ALT,
      eyebrow: "Nightjar Supply",
      heading: "Objects for *quiet* work",
      lead: "Twelve desk tools, carry goods and small lights, chosen for the hours after everyone else has gone home.",
      primaryLabel: "Shop all",
      primaryHref: "/products",
      secondaryLabel: "About",
      secondaryHref: "/about",
      variant: "display",
    }),
    section("home-new", [
      heading("New this season", { eyebrow: "Featured" }),
      node("shop.product-grid", { toolbar: false, chips: false, pageSize: 4, defaultSort: "featured", emptyText: "Nothing new this week." }, {}, "home-featured"),
    ]),
    section("home-shelves", [
      heading("Three shelves", { eyebrow: "Browse", intro: "Four objects on each: for the desk, for the walk, and for the light after dark." }),
      node("shop.grid", { columns: "3", gap: "lg" }, {}, "shelves"),
    ]),
    section("home-letters", [node("shop.newsletter", { heading: "Letters from the shelf", lead: "One short note when something new arrives. Nothing else, and never shared.", buttonLabel: "Subscribe" })], "surface"),
  ],
});
site.attach(featuredCards, { nodeId: "home-featured", slotId: "items" });
site.attach(categoryTiles, { nodeId: "shelves", slotId: "items" });

const catalog = site.page({
  name: "Catalog",
  template: frame,
  root: [
    heading("All products", { eyebrow: "Nightjar Supply", intro: "Twelve objects for quiet work. Filter by shelf, sort by price or search by name.", as: "h1" }),
    node("shop.product-grid", { toolbar: true, chips: true, pageSize: 8, defaultSort: "featured", emptyText: "No products match. Try another shelf or a shorter search." }, {}, "catalog"),
  ],
});
site.attach(productCards, { nodeId: "catalog", slotId: "items" }, "catalog-cards");

const categoryPages = (["desk", "carry", "light"] as const).map((id) => {
  const entry = categoryEntries[id]!.record.values;
  const name = entry[categories.fieldId("name")] as string;
  const imageObject = entry[categories.fieldId("image")] as Record<string, string>;
  const page = site.page({
    name: `${name} shelf`,
    id: `cat-${id}`,
    template: frame,
    root: [
      node("shop.hero", {
        src: imageObject[`${categories.fieldId("image")}-src`]!,
        alt: imageObject[`${categories.fieldId("image")}-alt`]!,
        eyebrow: "Shelf",
        heading: name,
        lead: entry[categories.fieldId("intro")] as string,
        primaryLabel: "",
        primaryHref: "#",
        secondaryLabel: "",
        secondaryHref: "#",
        variant: "compact",
      }),
      node("shop.product-grid", { toolbar: true, chips: false, pageSize: 8, defaultSort: "featured", emptyText: `Nothing on the ${name.toLowerCase()} shelf matches.` }, {}, id),
    ],
  });
  site.attach(categoryCards[id]!, { nodeId: id, slotId: "items" }, `${id}-cards`);
  return { id, name, page };
});

const productPage = site.page({
  name: "Product page",
  template: frame,
  root: [
    node("shop.breadcrumbs", { items: [{ label: "Home", href: "/" }, { label: "All products", href: "/products" }] }),
    node(
      "shop.product-hero",
      { ratio: "1/1" },
      {
        media: [
          node("shop.product-gallery", {}, { images: [node("shop.gallery-image", {}, {}, "product-image-1"), node("shop.gallery-image", {}, {}, "product-image-2")] }, "product-gallery"),
        ],
        copy: [
          node("shop.section-heading", { eyebrow: "", heading: "", intro: "", as: "h1" }, {}, "product-heading"),
          node("shop.price-tag", { size: "h2" }, {}, "product-price"),
          node("shop.status-badge", {}, {}, "product-status"),
          node("shop.add-to-cart", { maxQuantity: 10 }, {}, "product-cart"),
          node("shop.prose", {}, {}, "product-description"),
        ],
      },
    ),
    section("product-details", [heading("Details", { eyebrow: "Specification" }), node("shop.spec-table", {}, {}, "product-spec")]),
    section("product-more", [heading("More from the shelf", { eyebrow: "Featured" }), node("shop.related-products", { heading: "", limit: 3 }, {}, "product-related")]),
  ],
});

const specBinding = (key: string, index: number): BindingInput => ({
  field: "spec",
  nodeId: "product-spec",
  prop: `spec${index + 1}Value`,
  projection: { kind: "object-field", fieldIds: [`${products.fieldId("spec")}-${key}`] },
  id: `product-page-spec-${key}`,
});

const productPages = site.mapping({
  name: "Product page",
  model: products,
  composition: productPage,
  mode: { kind: "collection", sort: [{ field: "name", direction: "asc" }] },
  bindings: [
    { field: "name", nodeId: "product-heading", prop: "heading" },
    { field: "category", nodeId: "product-heading", prop: "eyebrow", projection: { kind: "reference-id" } },
    { field: "subtitle", nodeId: "product-heading", prop: "intro" },
    { field: "image1", nodeId: "product-image-1", prop: "src", projection: srcOf(products, "image1"), id: "product-page-image1-src" },
    { field: "image1", nodeId: "product-image-1", prop: "alt", projection: altOf(products, "image1"), id: "product-page-image1-alt" },
    { field: "image2", nodeId: "product-image-2", prop: "src", projection: srcOf(products, "image2"), id: "product-page-image2-src" },
    { field: "image2", nodeId: "product-image-2", prop: "alt", projection: altOf(products, "image2"), id: "product-page-image2-alt" },
    { field: "price", nodeId: "product-price", prop: "price" },
    { field: "currency", nodeId: "product-price", prop: "currency" },
    { field: "availability", nodeId: "product-status", prop: "availability" },
    { field: "stockLabel", nodeId: "product-status", prop: "label" },
    ...(["slug", "name", "price", "currency", "availability"] as const).map((field) => ({ field, nodeId: "product-cart", prop: field, id: `product-page-cart-${field}` })),
    { field: "image1", nodeId: "product-cart", prop: "src", projection: srcOf(products, "image1"), id: "product-page-cart-src" },
    { field: "description", nodeId: "product-description", prop: "markdown" },
    ...["material", "dimensions", "weight", "origin", "care", "warranty"].map(specBinding),
  ],
});
const relatedCards = productCardQuery("Related product cards", {
  kind: "collection",
  conditions: [{ field: "featured", operator: "equals", value: true }],
  sort: [{ field: "name", direction: "asc" }],
  limit: 4,
});
site.attach(relatedCards, { nodeId: "product-related", slotId: "items" }, "related-cards");

const cart = site.page({
  name: "Cart",
  template: frame,
  root: [
    heading("Your cart", { as: "h1" }),
    node("shop.cart-page", { emptyText: "Your cart is empty. The shelves are not.", emptyHref: "/products" }),
    node("shop.cart-summary", { shipping: 8, currency: "USD", checkoutHref: "/checkout", readOnly: false }),
    node("shop.demo-note", { text: "Demo — no data is sent." }),
  ],
});

const checkout = site.page({
  name: "Checkout",
  template: frame,
  root: [
    heading("Checkout", { as: "h1" }),
    node(
      "shop.split",
      { ratio: "3/2" },
      {
        left: [node("shop.checkout-form", { heading: "Shipping and payment", successHeading: "Order placed", successText: "Thank you. Nothing was charged and nothing will ship — this is a demo." })],
        right: [node("shop.cart-summary", { shipping: 8, currency: "USD", checkoutHref: "/checkout", readOnly: true })],
      },
    ),
    node("shop.demo-note", { text: "Demo — no data is sent." }),
  ],
});

const aboutPage = site.page({
  name: "About page",
  template: frame,
  root: [
    node("shop.section-heading", { eyebrow: "Nightjar Supply", heading: "", intro: "", as: "h1" }, {}, "about-heading"),
    node(
      "shop.split",
      { ratio: "1/1" },
      {
        left: [node("shop.image", { src: assetUrl("shop-hero"), alt: HERO_ALT, aspect: "4/3", caption: "The bench where the shop began." })],
        right: [node("shop.prose", {}, {}, "about-body")],
      },
    ),
    section("about-contact", [node("shop.contact-form", { heading: "Write to us", successText: "Thanks — in a real shop we would reply within two days." })]),
  ],
});
const aboutMapping = site.mapping({
  name: "About page",
  model: about,
  composition: aboutPage,
  bindings: [
    { field: "heading", nodeId: "about-heading", prop: "heading" },
    { field: "intro", nodeId: "about-heading", prop: "intro" },
    { field: "body", nodeId: "about-body", prop: "markdown" },
  ],
});

const faqPage = site.page({
  name: "FAQ page",
  id: "faq-page",
  template: frame,
  root: [
    heading("Questions", { eyebrow: "Help", intro: "Short answers about the shop, the cart and this demo.", as: "h1" }),
    node("shop.faq-accordion", { allowMultiple: false }, {}, "faq-list"),
  ],
});
site.attach(faqItems, { nodeId: "faq-list", slotId: "items" }, "faq-items");

// ---------------------------------------------------------------- sitemap

const productRoute: RouteInput = { id: "product", title: "Product", mapping: productPages, route: "entry-field", field: "slug", titleField: "name" };
const catalogRoute: RouteInput = { id: "catalog", title: "All products", slug: "products", page: catalog, children: [productRoute] };
const shelfRoutes: RouteInput[] = categoryPages.map(({ id, name, page }) => ({ id: `cat-${id}`, title: name, slug: id, page }));
const cartRoute: RouteInput = { id: "cart", title: "Cart", slug: "cart", page: cart };
const checkoutRoute: RouteInput = { id: "checkout", title: "Checkout", slug: "checkout", page: checkout };
const aboutRoute: RouteInput = { id: "about", title: "About", slug: "about", mapping: aboutMapping };
const faqRoute: RouteInput = { id: "faq", title: "FAQ", slug: "faq", page: faqPage };
const homeRoute: RouteInput = {
  id: "home",
  title: "Home",
  page: home,
  children: [catalogRoute, ...shelfRoutes, cartRoute, checkoutRoute, aboutRoute, faqRoute],
};

site.sitemap({
  name: "Nightjar Supply sitemap",
  root: homeRoute,
  navigation: {
    primary: [...shelfRoutes, catalogRoute, aboutRoute].map((route) => ({ route })),
    footer: [aboutRoute, faqRoute, cartRoute, checkoutRoute].map((route) => ({ route })),
  },
});

export default site;
