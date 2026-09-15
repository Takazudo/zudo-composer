import { defineComponent } from "@zudo-composer/component-contract";
import { useId } from "preact/hooks";
import { DemoNote } from "./demo-note";
import { FIELD_ERROR, FIELD_LABEL, CONTROL, DISABLED_CTA, PRIMARY_CTA } from "./tone";
import { formValues, isEmail, useMockSubmit } from "./form-field";

export interface NewsletterProps {
  heading: string;
  lead: string;
  buttonLabel: string;
}

export function Newsletter({ heading = "Letters from the shelf", lead = "One short note when something new arrives.", buttonLabel = "Subscribe" }: NewsletterProps) {
  const id = useId();
  const { status, errors, onSubmit } = useMockSubmit<"email">((form) => (isEmail(formValues(form, ["email"]).email) ? {} : { email: "Enter an email like you@example.com." }));
  const pending = status === "pending";
  return (
    <div class="flex max-w-shop-prose flex-col gap-shop-vsp-sm">
      <h2 class="text-shop-h2 font-shop-semibold text-shop-fg-strong">{heading}</h2>
      {lead !== "" && <p class="text-shop-body text-shop-fg">{lead}</p>}
      {status === "done" ? (
        <p role="status" class="text-shop-body text-shop-success">Thanks — this demo keeps nothing.</p>
      ) : (
        <form noValidate onSubmit={onSubmit} class="flex flex-col gap-shop-vsp-xs">
          <label for={`${id}-email`} class={FIELD_LABEL}>Email</label>
          <div class="flex flex-wrap gap-shop-hsp-xs">
            <input
              id={`${id}-email`}
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? `${id}-email-error` : undefined}
              class={`min-w-0 flex-1 ${CONTROL}`}
            />
            <button type="submit" disabled={pending} class={pending ? DISABLED_CTA : PRIMARY_CTA}>{pending ? "Sending…" : buttonLabel}</button>
          </div>
          {errors.email && <p id={`${id}-email-error`} class={FIELD_ERROR}>{errors.email}</p>}
        </form>
      )}
      <DemoNote text="Demo — no data is sent." />
    </div>
  );
}

export const newsletterComponent = defineComponent<NewsletterProps>()(Newsletter, {
  id: "shop.newsletter",
  schemaVersion: 1,
  title: "Newsletter",
  category: "Content",
  description: "Mock email sign-up: format check, 600 ms, then a thank-you. Sends nothing.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "Newsletter" },
  defaults: { heading: "Letters from the shelf", lead: "One short note when something new arrives.", buttonLabel: "Subscribe" },
  fields: [
    { kind: "text", prop: "heading", label: "Heading" },
    { kind: "text", prop: "lead", label: "Lead" },
    { kind: "text", prop: "buttonLabel", label: "Button label" },
  ],
});
