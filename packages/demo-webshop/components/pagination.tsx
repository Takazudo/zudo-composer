import { defineComponent } from "@zudo-composer/component-contract";
import { HOVER_INVERT } from "./tone";

export interface PaginationProps {
  page: number;
  pageCount: number;
  /** Set by `shop.product-grid`; standalone (authored) pagination renders `?page=n` links. */
  onPage?: (page: number) => void;
}

const ITEM = `inline-flex items-center justify-center min-w-[2.75rem] h-shop-control-h px-shop-hsp-xs border text-shop-body font-shop-mono tabular-nums`;

export function Pagination({ page = 1, pageCount = 1, onPage }: PaginationProps) {
  const count = Math.max(1, Math.floor(pageCount));
  const current = Math.min(Math.max(1, Math.floor(page)), count);
  const control = (target: number, label: string, text: string, disabled = false) => {
    const tone = target === current && text !== "Prev" && text !== "Next"
      ? "border-shop-fg-strong text-shop-fg-strong"
      : disabled
        ? "border-shop-border text-shop-faint"
        : `border-shop-border text-shop-fg-strong ${HOVER_INVERT}`;
    const ariaCurrent = target === current && text === String(target) ? "page" : undefined;
    if (onPage) {
      return (
        <button type="button" class={`${ITEM} ${tone}`} aria-label={label} aria-current={ariaCurrent} disabled={disabled} onClick={() => onPage(target)}>
          {text}
        </button>
      );
    }
    return disabled
      ? <span class={`${ITEM} ${tone}`} aria-disabled="true">{text}</span>
      : <a class={`${ITEM} ${tone}`} href={`?page=${target}`} aria-label={label} aria-current={ariaCurrent}>{text}</a>;
  };
  return (
    <nav aria-label="Pagination" class="flex flex-wrap items-center gap-shop-hsp-xs">
      {control(current - 1, "Previous page", "Prev", current === 1)}
      {Array.from({ length: count }, (_, index) => index + 1).map((target) => (
        <span key={target}>{control(target, `Page ${target}`, String(target))}</span>
      ))}
      {control(current + 1, "Next page", "Next", current === count)}
    </nav>
  );
}

export const paginationComponent = defineComponent<PaginationProps>()(Pagination, {
  id: "shop.pagination",
  schemaVersion: 1,
  title: "Pagination",
  category: "Catalog",
  description: "Prev / page numbers / next; the product grid renders its own.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "Pagination" },
  defaults: { page: 1, pageCount: 3 },
  fields: [
    { kind: "number", prop: "page", label: "Page", min: 1, step: 1 },
    { kind: "number", prop: "pageCount", label: "Page count", min: 1, step: 1 },
  ],
  staticProps: [{ prop: "onPage", reason: "Callback supplied by shop.product-grid." }],
});
