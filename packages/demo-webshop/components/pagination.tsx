import { defineComponent } from "@zudo-composer/component-contract";
import { For, computed, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { HOVER_INVERT } from "./tone";

export interface PaginationProps {
  page: number;
  pageCount: number;
  /** Set by `shop.product-grid`; standalone (authored) pagination renders `?page=n` links. */
  onPage?: (page: number) => void;
}

const ITEM = `inline-flex items-center justify-center min-w-[2.75rem] h-shop-control-h px-shop-hsp-xs border text-shop-body font-shop-mono tabular-nums`;

export interface PaginationControlsProps {
  page: ReadonlySignal<number>;
  pageCount: ReadonlySignal<number>;
  onPage?: ((page: number) => void) | undefined;
}

/** The live form `shop.product-grid` renders: retained page buttons keep focus while the page changes. */
export function PaginationControls({ page, pageCount, onPage }: PaginationControlsProps) {
  const count = computed(() => Math.max(1, Math.floor(pageCount.value)));
  const current = computed(() => Math.min(Math.max(1, Math.floor(page.value)), count.value));
  const targets = computed(() => Array.from({ length: count.value }, (_, index) => index + 1));
  const control = (target: ReadonlySignal<number>, label: ReadonlySignal<string>, text: ReadonlySignal<string>, disabled: ReadonlySignal<boolean>, step: boolean) => {
    const isCurrent = computed(() => !step && target.value === current.value);
    const tone = computed(() =>
      isCurrent.value
        ? "border-shop-fg-strong text-shop-fg-strong"
        : disabled.value
          ? "border-shop-border text-shop-faint"
          : `border-shop-border text-shop-fg-strong ${HOVER_INVERT}`,
    );
    const ariaCurrent = computed(() => (isCurrent.value ? "page" : null));
    const itemClass = computed(() => `${ITEM} ${tone.value}`);
    if (onPage) {
      return (
        <button type="button" class={itemClass} aria-label={label} aria-current={ariaCurrent} disabled={disabled} on:click={() => onPage(target.value)}>
          {text}
        </button>
      );
    }
    // Standalone (authored) pagination is static: its props never change without a remount.
    return disabled.value
      ? <span class={itemClass} aria-disabled="true">{text}</span>
      : <a class={itemClass} href={`?page=${target.value}`} aria-label={label} aria-current={ariaCurrent}>{text}</a>;
  };
  const fixed = <T,>(value: T) => computed(() => value);
  return (
    <nav aria-label="Pagination" class="flex flex-wrap items-center gap-shop-hsp-xs">
      {control(computed(() => current.value - 1), fixed("Previous page"), fixed("Prev"), computed(() => current.value === 1), true)}
      <For each={targets} by={(target) => target}>
        {(target) => <span>{control(target, computed(() => `Page ${target.value}`), computed(() => String(target.value)), fixed(false), false)}</span>}
      </For>
      {control(computed(() => current.value + 1), fixed("Next page"), fixed("Next"), computed(() => current.value === count.value), true)}
    </nav>
  );
}

export function Pagination({ page = 1, pageCount = 1, onPage }: PaginationProps) {
  return <PaginationControls page={computed(() => page)} pageCount={computed(() => pageCount)} onPage={onPage} />;
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
