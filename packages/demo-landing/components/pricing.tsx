import { Show, computed, getScope, signal, type Child, type ReadonlySignal, type Ref } from "@takazudo/zfb/zudo-react";
import { buttonClass } from "./chrome";
import { Icon } from "./icons";
import { answerLink, requestLink, slotLink } from "./slot-link";

export type Billing = "monthly" | "yearly";

export const BILLING_STORAGE_KEY = "orrery-billing";

export interface BillingState {
  billing: ReadonlySignal<Billing>;
  currency: string;
}

/** Answered by `land.pricing-table`; a tier outside one renders monthly prices. */
export const BILLING_LINK = slotLink<BillingState>("land-billing");

function readStoredBilling(): Billing | null {
  try {
    const stored = window.localStorage.getItem(BILLING_STORAGE_KEY);
    return stored === "monthly" || stored === "yearly" ? stored : null;
  } catch {
    return null;
  }
}

function storeBilling(billing: Billing): void {
  try {
    window.localStorage.setItem(BILLING_STORAGE_KEY, billing);
  } catch {
    // Storage can be blocked; the toggle still works for this page view.
  }
}

export function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export interface PricingTableProps {
  defaultBilling: Billing;
  currency: string;
  yearlyNote: string;
  tiers?: Child | object;
}

export function PricingTable({ defaultBilling, currency, yearlyNote, tiers }: PricingTableProps) {
  const billing = signal<Billing>(defaultBilling);
  getScope().onActivate(() => {
    const stored = readStoredBilling();
    if (stored) billing.value = stored;
  });
  const yearly = computed(() => billing.value === "yearly");
  const toggle = () => {
    const next: Billing = yearly.value ? "monthly" : "yearly";
    billing.value = next;
    storeBilling(next);
  };
  const segment = (active: ReadonlySignal<boolean>) =>
    computed(() => `inline-flex h-full items-center rounded-land-pill px-land-hsp-md ${active.value ? "bg-land-accent text-land-accent-fg" : "text-land-fg"}`);
  return (
    <div class="flex flex-col gap-land-vsp-md" on:land-billing={answerLink(BILLING_LINK, { billing, currency })}>
      <div class="flex flex-wrap items-center justify-center gap-land-hsp-sm">
        <button
          type="button"
          role="switch"
          aria-checked={yearly}
          aria-label="Bill yearly"
          on:click={toggle}
          class="inline-flex h-land-control-h items-center rounded-land-pill border border-land-border bg-land-surface-2 text-land-body"
        >
          <span class={segment(computed(() => !yearly.value))}>Monthly</span>
          <span class={segment(yearly)}>Yearly</span>
        </button>
        {yearlyNote && <span class="text-land-caption text-land-muted">{yearlyNote}</span>}
      </div>
      <div class="grid items-stretch gap-land-hsp-md land-md:grid-cols-3">{tiers as Child}</div>
    </div>
  );
}

export interface PricingTierProps {
  name: string;
  tagline: string;
  priceMonthly: number;
  /** Per month, billed yearly. */
  priceYearly: number;
  currency: string;
  ctaLabel: string;
  ctaHref: string;
  popular: boolean;
  feature1: string;
  feature2: string;
  feature3: string;
  feature4: string;
  feature5: string;
  feature6: string;
  /** Sort key the Mapping query orders by; the table keeps DOM order. */
  order: number;
}

export function PricingTier(props: PricingTierProps) {
  const element: Ref<HTMLElement> = { current: null };
  const table = signal<BillingState | null>(null);
  getScope().onActivate(() => {
    table.value = requestLink(BILLING_LINK, element.current) ?? null;
  });
  const billing = computed<Billing>(() => table.value?.billing.value ?? "monthly");
  const currency = computed(() => props.currency || table.value?.currency || "USD");
  const yearly = computed(() => billing.value === "yearly");
  const price = computed(() => (yearly.value ? props.priceYearly : props.priceMonthly));
  const features = [props.feature1, props.feature2, props.feature3, props.feature4, props.feature5, props.feature6].filter((feature) => feature?.trim());
  const frame = props.popular ? "border-land-accent" : "border-land-border";
  return (
    <article ref={element} data-billing={billing} class={`flex flex-col gap-land-vsp-md rounded-land-md border bg-land-surface p-land-hsp-lg ${frame}`}>
      <header class="flex flex-col gap-land-vsp-xs">
        <div class="flex items-center justify-between gap-land-hsp-sm">
          <h3 class="text-land-h3 text-land-fg-strong">{props.name}</h3>
          {props.popular && <span class="rounded-land-pill border border-land-accent px-land-hsp-xs text-land-caption text-land-accent">Popular</span>}
        </div>
        {props.tagline && <p class="text-land-body text-land-muted">{props.tagline}</p>}
      </header>
      <div class="flex flex-col gap-land-vsp-xs">
        <p class="flex items-baseline gap-land-hsp-xs">
          <span data-price class="text-land-price tracking-land-tight text-land-fg-strong tabular-nums">{computed(() => formatPrice(price.value, currency.value))}</span>
          {props.priceMonthly > props.priceYearly && (
            <Show when={yearly}>
              {() => <s class="text-land-body text-land-faint tabular-nums">{computed(() => formatPrice(props.priceMonthly, currency.value))}</s>}
            </Show>
          )}
        </p>
        <p class="text-land-caption text-land-muted">{computed(() => (yearly.value ? "per month, billed yearly" : "per month"))}</p>
      </div>
      <ul class="flex flex-1 flex-col gap-land-vsp-xs">
        {features.map((feature) => (
          <li class="flex items-start gap-land-hsp-xs text-land-body text-land-fg">
            <Icon name="check" class={`size-land-icon shrink-0 ${props.popular ? "text-land-accent" : "text-land-muted"}`} />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      {props.ctaLabel && <a href={props.ctaHref || undefined} class={`w-full ${buttonClass("secondary", "md")}`}>{props.ctaLabel}</a>}
    </article>
  );
}
