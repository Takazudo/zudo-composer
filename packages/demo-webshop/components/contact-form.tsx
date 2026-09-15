import { defineComponent } from "@zudo-composer/component-contract";
import { useId } from "preact/hooks";
import { DemoNote } from "./demo-note";
import { FormField, formValues, isEmail, useMockSubmit, type FieldErrors } from "./form-field";
import { DISABLED_CTA, PRIMARY_CTA } from "./tone";

export interface ContactFormProps {
  heading: string;
  successText: string;
}

const CONTACT_FIELDS = ["name", "email", "message"] as const;
type ContactField = (typeof CONTACT_FIELDS)[number];

export function validateContact(values: Record<ContactField, string>): FieldErrors<ContactField> {
  const errors: FieldErrors<ContactField> = {};
  if (values.name.trim() === "") errors.name = "Name is required.";
  if (values.email.trim() === "") errors.email = "Email is required.";
  else if (!isEmail(values.email)) errors.email = "Enter an email like you@example.com.";
  if (values.message.trim() === "") errors.message = "Message is required.";
  return errors;
}

export function ContactForm({ heading = "Write to us", successText = "Thanks — in a real shop we would reply within two days." }: ContactFormProps) {
  const id = useId();
  const { status, errors, onSubmit } = useMockSubmit<ContactField>((form) => validateContact(formValues(form, CONTACT_FIELDS)));
  const pending = status === "pending";
  return (
    <div class="flex max-w-shop-prose flex-col gap-shop-vsp-md">
      <h2 class="text-shop-h2 font-shop-semibold text-shop-fg-strong">{heading}</h2>
      {status === "done" ? (
        <p role="status" class="whitespace-pre-line text-shop-body text-shop-success">{successText}</p>
      ) : (
        <form noValidate onSubmit={onSubmit} class="flex flex-col gap-shop-vsp-md">
          <FormField id={id} name="name" label="Name" autoComplete="name" error={errors.name} />
          <FormField id={id} name="email" label="Email" type="email" autoComplete="email" error={errors.email} />
          <FormField id={id} name="message" label="Message" multiline error={errors.message} />
          <button type="submit" disabled={pending} class={`self-start ${pending ? DISABLED_CTA : PRIMARY_CTA}`}>{pending ? "Sending…" : "Send message"}</button>
        </form>
      )}
      <DemoNote text="Demo — no data is sent." />
    </div>
  );
}

export const contactFormComponent = defineComponent<ContactFormProps>()(ContactForm, {
  id: "shop.contact-form",
  schemaVersion: 1,
  title: "Contact form",
  category: "Content",
  description: "Mock name / email / message form: required fields, 600 ms, then the success text. Sends nothing.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "ContactForm" },
  defaults: { heading: "Write to us", successText: "Thanks — in a real shop we would reply within two days." },
  fields: [
    { kind: "text", prop: "heading", label: "Heading" },
    { prop: "successText", label: "Success text", schema: { type: "string" }, editor: { kind: "text", multiline: true } },
  ],
});
