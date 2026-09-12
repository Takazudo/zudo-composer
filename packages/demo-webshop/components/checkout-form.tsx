import { defineComponent } from "@zudo-composer/component-contract";
import { useId, useState } from "preact/hooks";
import { cartStore } from "./cart-store";
import { DemoNote } from "./demo-note";
import { FormField, formValues, isEmail, useMockSubmit, type FieldErrors } from "./form-field";
import { CONTROL, DISABLED_CTA, PRIMARY_CTA } from "./tone";

export interface CheckoutFormProps {
  heading: string;
  successHeading: string;
  successText: string;
}

export const CHECKOUT_FIELDS = ["name", "email", "address", "city", "postcode", "country", "card", "expiry", "cvc"] as const;
export type CheckoutField = (typeof CHECKOUT_FIELDS)[number];

const COUNTRIES = ["United States", "Canada", "United Kingdom", "Germany", "Japan", "Australia"];

export function validateCheckout(values: Record<CheckoutField, string>): FieldErrors<CheckoutField> {
  const errors: FieldErrors<CheckoutField> = {};
  const labels: Record<CheckoutField, string> = {
    name: "Name",
    email: "Email",
    address: "Address",
    city: "City",
    postcode: "Postcode",
    country: "Country",
    card: "Card number",
    expiry: "Expiry",
    cvc: "CVC",
  };
  for (const field of CHECKOUT_FIELDS) if (values[field].trim() === "") errors[field] = `${labels[field]} is required.`;
  if (!errors.email && !isEmail(values.email)) errors.email = "Enter an email like you@example.com.";
  if (!errors.card && !/^\d{16}$/.test(values.card.replace(/[\s-]/g, ""))) errors.card = "Card number must be 16 digits.";
  if (!errors.expiry && !/^(0[1-9]|1[0-2])\/\d{2}$/.test(values.expiry.trim())) errors.expiry = "Use MM/YY.";
  if (!errors.cvc && !/^\d{3,4}$/.test(values.cvc.trim())) errors.cvc = "CVC is 3 or 4 digits.";
  return errors;
}

export function fakeOrderNumber(random: () => number = Math.random): string {
  return `NJ-${String(Math.floor(random() * 1_000_000)).padStart(6, "0")}`;
}

export function CheckoutForm({
  heading = "Shipping and payment",
  successHeading = "Order placed",
  successText = "Thank you. Nothing was charged and nothing will ship — this is a demo.",
}: CheckoutFormProps) {
  const id = useId();
  const [orderNumber, setOrderNumber] = useState("");
  const { status, errors, onSubmit } = useMockSubmit<CheckoutField>(
    (form) => validateCheckout(formValues(form, CHECKOUT_FIELDS)),
    () => {
      setOrderNumber(fakeOrderNumber());
      cartStore.clear();
    },
  );

  if (status === "done") {
    return (
      <div role="status" class="flex flex-col gap-shop-vsp-sm border border-shop-success p-shop-hsp-md">
        <h2 class="text-shop-h2 font-shop-semibold text-shop-success">{successHeading}</h2>
        <p class="text-shop-body text-shop-fg">
          Order number <span class="font-shop-mono tabular-nums text-shop-fg-strong">{orderNumber}</span>
        </p>
        <p class="whitespace-pre-line text-shop-body text-shop-fg">{successText}</p>
        <DemoNote text="Demo — no data is sent." />
      </div>
    );
  }

  const pending = status === "pending";
  return (
    <form noValidate onSubmit={onSubmit} aria-busy={pending} class="flex flex-col gap-shop-vsp-md">
      <h2 class="text-shop-h2 font-shop-semibold text-shop-fg-strong">{heading}</h2>
      <fieldset class="grid grid-cols-1 gap-shop-vsp-md shop-sm:grid-cols-2 shop-sm:gap-x-shop-hsp-md">
        <legend class="sr-only">Shipping</legend>
        <FormField id={id} name="name" label="Full name" autoComplete="name" error={errors.name} />
        <FormField id={id} name="email" label="Email" type="email" autoComplete="email" error={errors.email} />
        <div class="shop-sm:col-span-2">
          <FormField id={id} name="address" label="Address" autoComplete="street-address" error={errors.address} />
        </div>
        <FormField id={id} name="city" label="City" autoComplete="address-level2" error={errors.city} />
        <FormField id={id} name="postcode" label="Postcode" autoComplete="postal-code" error={errors.postcode} />
        <FormField id={id} name="country" label="Country" error={errors.country}>
          <select
            id={`${id}-country`}
            name="country"
            autoComplete="country-name"
            aria-invalid={errors.country ? true : undefined}
            aria-describedby={errors.country ? `${id}-country-error` : undefined}
            class={`w-full ${CONTROL}`}
          >
            <option value="">Choose a country</option>
            {COUNTRIES.map((country) => <option key={country} value={country}>{country}</option>)}
          </select>
        </FormField>
      </fieldset>
      <fieldset class="grid grid-cols-2 gap-shop-vsp-md gap-x-shop-hsp-md border-t border-shop-border pt-shop-vsp-md">
        <legend class="sr-only">Payment</legend>
        <div class="col-span-2">
          <FormField id={id} name="card" label="Card number (any 16 digits)" inputMode="numeric" autoComplete="off" placeholder="0000 0000 0000 0000" error={errors.card} />
        </div>
        <FormField id={id} name="expiry" label="Expiry" autoComplete="off" placeholder="MM/YY" error={errors.expiry} />
        <FormField id={id} name="cvc" label="CVC" inputMode="numeric" autoComplete="off" error={errors.cvc} />
      </fieldset>
      <button type="submit" disabled={pending} class={pending ? DISABLED_CTA : `${PRIMARY_CTA} justify-center`}>
        {pending ? "Placing order…" : "Place order"}
      </button>
      <DemoNote text="Demo — no data is sent." />
    </form>
  );
}

export const checkoutFormComponent = defineComponent<CheckoutFormProps>()(CheckoutForm, {
  id: "shop.checkout-form",
  schemaVersion: 1,
  title: "Checkout form",
  category: "Cart",
  description: "Mock checkout: validates, waits 600 ms, shows a fake order number and clears the cart. Sends nothing.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "CheckoutForm" },
  defaults: {
    heading: "Shipping and payment",
    successHeading: "Order placed",
    successText: "Thank you. Nothing was charged and nothing will ship — this is a demo.",
  },
  fields: [
    { kind: "text", prop: "heading", label: "Heading" },
    { kind: "text", prop: "successHeading", label: "Success heading" },
    { prop: "successText", label: "Success text", schema: { type: "string" }, editor: { kind: "text", multiline: true } },
  ],
});
