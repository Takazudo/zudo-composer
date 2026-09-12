import { createContext, type ComponentChildren } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";
import { buttonClass } from "./chrome";
import { Icon } from "./icons";

export type Billing = "monthly" | "yearly";

export const BILLING_STORAGE_KEY = "orrery-billing";

export interface BillingState {
  billing: Billing;
  currency: string;
}

/** Provided by `land.pricing-table`; a tier without it renders monthly prices. */
export const BillingContext = createContext<BillingState | null>(null);

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
  tiers?: ComponentChildren;
}

export function PricingTable({ defaultBilling, currency, yearlyNote, tiers }: PricingTableProps) {
  const [billing, setBilling] = useState<Billing>(defaultBilling);
  useEffect(() => {
    const stored = readStoredBilling();
    if (stored) setBilling(stored);
  }, []);
  const yearly = billing === "yearly";
  const toggle = () => {
    const next: Billing = yearly ? "monthly" : "yearly";
    setBilling(next);
    storeBilling(next);
  };
  const segment = (active: boolean) =>
    `inline-flex h-full items-center rounded-land-pill px-land-hsp-md ${active ? "bg-land-accent text-land-accent-fg" : "text-land-fg"}`;
  return (
    <BillingContext.Provider value={{ billing, currency }}>
      <div class="flex flex-col gap-land-vsp-md">
        <div class="flex flex-wrap items-center justify-center gap-land-hsp-sm">
          <button
            type="button"
            role="switch"
            aria-checked={yearly}
            aria-label="Bill yearly"
            onClick={toggle}
            class="inline-flex h-land-control-h items-center rounded-land-pill border border-land-border bg-land-surface-2 text-land-body"
          >
            <span class={segment(!yearly)}>Monthly</span>
            <span class={segment(yearly)}>Yearly</span>
          </button>
          {yearlyNote && <span class="text-land-caption text-land-muted">{yearlyNote}</span>}
        </div>
        <div class="grid items-stretch gap-land-hsp-md land-md:grid-cols-3">{tiers}</div>
      </div>
    </BillingContext.Provider>
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
  const context = useContext(BillingContext);
  const billing = context?.billing ?? "monthly";
  const currency = props.currency || context?.currency || "USD";
  const yearly = billing === "yearly";
  const price = yearly ? props.priceYearly : props.priceMonthly;
  const features = [props.feature1, props.feature2, props.feature3, props.feature4, props.feature5, props.feature6].filter((feature) => feature?.trim());
  const frame = props.popular ? "border-land-accent" : "border-land-border";
  return (
    <article data-billing={billing} class={`flex flex-col gap-land-vsp-md rounded-land-md border bg-land-surface p-land-hsp-lg ${frame}`}>
      <header class="flex flex-col gap-land-vsp-xs">
        <div class="flex items-center justify-between gap-land-hsp-sm">
          <h3 class="text-land-h3 text-land-fg-strong">{props.name}</h3>
          {props.popular && <span class="rounded-land-pill border border-land-accent px-land-hsp-xs text-land-caption text-land-accent">Popular</span>}
        </div>
        {props.tagline && <p class="text-land-body text-land-muted">{props.tagline}</p>}
      </header>
      <div class="flex flex-col gap-land-vsp-xs">
        <p class="flex items-baseline gap-land-hsp-xs">
          <span data-price class="text-land-price tracking-land-tight text-land-fg-strong tabular-nums">{formatPrice(price, currency)}</span>
          {yearly && props.priceMonthly > props.priceYearly && (
            <s class="text-land-body text-land-faint tabular-nums">{formatPrice(props.priceMonthly, currency)}</s>
          )}
        </p>
        <p class="text-land-caption text-land-muted">{yearly ? "per month, billed yearly" : "per month"}</p>
      </div>
      <ul class="flex flex-1 flex-col gap-land-vsp-xs">
        {features.map((feature) => (
          <li key={feature} class="flex items-start gap-land-hsp-xs text-land-body text-land-fg">
            <Icon name="check" class={`size-land-icon shrink-0 ${props.popular ? "text-land-accent" : "text-land-muted"}`} />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      {props.ctaLabel && <a href={props.ctaHref || undefined} class={`w-full ${buttonClass("secondary", "md")}`}>{props.ctaLabel}</a>}
    </article>
  );
}
