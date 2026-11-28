import { defineComponent } from "@zudo-composer/component-contract";
import { Show, computed } from "@takazudo/zfb/zudo-react";
import { DemoNote } from "./demo-note";
import { FIELD_ERROR, FIELD_LABEL, CONTROL, DISABLED_CTA, PRIMARY_CTA } from "./tone";
import { fieldError, formId, formValues, isEmail, mockSubmit } from "./form-field";

export interface NewsletterProps {
  heading: string;
  lead: string;
  buttonLabel: string;
}

export function Newsletter({ heading = "Letters from the shelf", lead = "One short note when something new arrives.", buttonLabel = "Subscribe" }: NewsletterProps) {
  const id = formId();
  const { status, errors, onSubmit } = mockSubmit<"email">((form) => (isEmail(formValues(form, ["email"]).email) ? {} : { email: "Enter an email like you@example.com." }));
  const pending = computed(() => status.value === "pending");
  const error = fieldError(errors, "email");
  return (
    <div class="flex max-w-shop-prose flex-col gap-shop-vsp-sm">
      <h2 class="text-shop-h2 font-shop-semibold text-shop-fg-strong">{heading}</h2>
      {lead !== "" && <p class="text-shop-body text-shop-fg">{lead}</p>}
      <Show
        when={computed(() => status.value === "done")}
        fallback={() => (
          <form novalidate on:submit={onSubmit} class="flex flex-col gap-shop-vsp-xs">
            <label for={`${id}-email`} class={FIELD_LABEL}>Email</label>
            <div class="flex flex-wrap gap-shop-hsp-xs">
              <input
                id={`${id}-email`}
                name="email"
                type="email"
                autocomplete="email"
                placeholder="you@example.com"
                aria-invalid={computed(() => (error.value ? true : null))}
                aria-describedby={computed(() => (error.value ? `${id}-email-error` : null))}
                class={`min-w-0 flex-1 ${CONTROL}`}
              />
              <button type="submit" disabled={pending} class={computed(() => (pending.value ? DISABLED_CTA : PRIMARY_CTA))}>
                {computed(() => (pending.value ? "Sending…" : buttonLabel))}
              </button>
            </div>
            <Show when={computed(() => Boolean(error.value))}>
              {() => <p id={`${id}-email-error`} class={FIELD_ERROR}>{error}</p>}
            </Show>
          </form>
        )}
      >
        {() => <p role="status" class="text-shop-body text-shop-success">Thanks — this demo keeps nothing.</p>}
      </Show>
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
