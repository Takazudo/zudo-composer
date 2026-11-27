import type { GridItemData, GridItemView } from "./grid-view";
import type { ItemHost } from "./item-registry";
import { slotLink } from "./slot-link";

/** Answered by `shop.product-grid` and `shop.related-products`; a card outside both stays visible in natural order. */
export const GRID_ITEM_LINK = slotLink<ItemHost<GridItemData, GridItemView>>("shop-grid-item");
