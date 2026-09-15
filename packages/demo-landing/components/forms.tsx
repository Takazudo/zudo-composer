import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { DemoNote, buttonClass } from "./chrome";

/** Mock forms send nothing: they validate, wait this long, then show success. */
export const MOCK_DELAY_MS = 600;
export const DEMO_NOTE = "Demo — no data is sent.";
export const TEAM_SIZES = ["1–5", "6–20", "21–50", "51+"] as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

type Status = "idle" | "sending" | "sent";

function useMockSubmit(): [Status, () => void] {
  const [status, setStatus] = useState<Status>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const send = () => {
    setStatus("sending");
    timer.current = setTimeout(() => setStatus("sent"), MOCK_DELAY_MS);
  };
  return [status, send];
}

const controlClass = "w-full rounded-land-md border border-land-border bg-land-surface px-land-hsp-sm text-land-body text-land-fg placeholder:text-land-faint aria-[invalid=true]:border-land-danger";
const formClass = "mx-auto flex w-full max-w-land-narrow flex-col gap-land-vsp-md rounded-land-md border border-land-border bg-land-surface p-land-hsp-md land-md:p-land-hsp-lg";

function Field({ id, label, error, children }: { id: string; label: string; error: string | undefined; children: ComponentChildren }) {
  return (
    <div class="flex flex-col gap-land-vsp-xs">
      <label for={id} class="text-land-caption text-land-fg-strong">{label}</label>
      {children}
      {error && <p id={`${id}-error`} class="text-land-caption text-land-danger">{error}</p>}
    </div>
  );
}

function errorProps(id: string, error: string | undefined) {
  return { "aria-invalid": error ? true : undefined, "aria-describedby": error ? `${id}-error` : undefined };
}

function SuccessPanel({ heading, text }: { heading?: string; text: string }) {
  return (
    <div role="status" class="mx-auto flex w-full max-w-land-narrow flex-col gap-land-vsp-xs rounded-land-md border border-land-success bg-land-surface p-land-hsp-md land-md:p-land-hsp-lg">
      {heading && <h2 class="text-land-h3 text-land-success">{heading}</h2>}
      <p class="text-land-body text-land-fg">{text}</p>
      <DemoNote text={DEMO_NOTE} />
    </div>
  );
}

export interface SignupFormProps {
  heading: string;
  lead: string;
  buttonLabel: string;
  successHeading: string;
  successText: string;
}

export function SignupForm({ heading, lead, buttonLabel, successHeading, successText }: SignupFormProps) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [errors, setErrors] = useState<{ email?: string; teamSize?: string }>({});
  const [status, send] = useMockSubmit();
  if (status === "sent") return <SuccessPanel heading={successHeading} text={successText} />;
  const onSubmit = (event: Event) => {
    event.preventDefault();
    if (status !== "idle") return;
    const next = {
      ...(isEmail(email) ? {} : { email: "Enter a work email, like name@company.com." }),
      ...(teamSize ? {} : { teamSize: "Choose your team size." }),
    };
    setErrors(next);
    if (Object.keys(next).length === 0) send();
  };
  const emailId = `${id}-email`;
  const teamId = `${id}-team`;
  return (
    <form noValidate onSubmit={onSubmit} class={formClass}>
      <div class="flex flex-col gap-land-vsp-sm">
        <h2 class="text-land-h2-compact tracking-land-tight text-land-fg-strong land-md:text-land-h2">{heading}</h2>
        {lead && <p class="text-land-lead text-land-fg">{lead}</p>}
      </div>
      <Field id={emailId} label="Work email" error={errors.email}>
        <input id={emailId} name="email" type="email" autocomplete="email" placeholder="name@company.com" value={email} onInput={(event) => setEmail(event.currentTarget.value)} class={`h-land-control-h ${controlClass}`} {...errorProps(emailId, errors.email)} />
      </Field>
      <Field id={teamId} label="Team size" error={errors.teamSize}>
        <select id={teamId} name="teamSize" value={teamSize} onChange={(event) => setTeamSize(event.currentTarget.value)} class={`h-land-control-h ${controlClass}`} {...errorProps(teamId, errors.teamSize)}>
          <option value="">Choose a size</option>
          {TEAM_SIZES.map((size) => <option key={size} value={size}>{size} people</option>)}
        </select>
      </Field>
      <button type="submit" disabled={status === "sending"} class={`disabled:opacity-60 ${buttonClass("primary", "lg")}`}>
        {status === "sending" ? "Sending…" : buttonLabel}
      </button>
      <DemoNote text={DEMO_NOTE} />
    </form>
  );
}

export interface ContactFormProps {
  heading: string;
  successText: string;
}

export function ContactForm({ heading, successText }: ContactFormProps) {
  const id = useId();
  const [values, setValues] = useState({ name: "", email: "", message: "" });
  const [errors, setErrors] = useState<{ name?: string; email?: string; message?: string }>({});
  const [status, send] = useMockSubmit();
  if (status === "sent") return <SuccessPanel text={successText} />;
  const update = (key: keyof typeof values) => (event: { currentTarget: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.currentTarget.value }));
  const onSubmit = (event: Event) => {
    event.preventDefault();
    if (status !== "idle") return;
    const next = {
      ...(values.name.trim() ? {} : { name: "Tell us your name." }),
      ...(isEmail(values.email) ? {} : { email: "Enter an email we can reply to." }),
      ...(values.message.trim() ? {} : { message: "Write a short message." }),
    };
    setErrors(next);
    if (Object.keys(next).length === 0) send();
  };
  const nameId = `${id}-name`;
  const emailId = `${id}-email`;
  const messageId = `${id}-message`;
  return (
    <form noValidate onSubmit={onSubmit} class={formClass}>
      <h2 class="text-land-h3 text-land-fg-strong">{heading}</h2>
      <Field id={nameId} label="Name" error={errors.name}>
        <input id={nameId} name="name" autocomplete="name" value={values.name} onInput={update("name")} class={`h-land-control-h ${controlClass}`} {...errorProps(nameId, errors.name)} />
      </Field>
      <Field id={emailId} label="Email" error={errors.email}>
        <input id={emailId} name="email" type="email" autocomplete="email" value={values.email} onInput={update("email")} class={`h-land-control-h ${controlClass}`} {...errorProps(emailId, errors.email)} />
      </Field>
      <Field id={messageId} label="Message" error={errors.message}>
        <textarea id={messageId} name="message" rows={5} value={values.message} onInput={update("message")} class={`py-land-vsp-xs ${controlClass}`} {...errorProps(messageId, errors.message)} />
      </Field>
      <button type="submit" disabled={status === "sending"} class={`disabled:opacity-60 ${buttonClass("primary", "md")}`}>
        {status === "sending" ? "Sending…" : "Send message"}
      </button>
      <DemoNote text={DEMO_NOTE} />
    </form>
  );
}
