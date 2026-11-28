import { Show, computed, getScope, signal, type Child, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
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

function mockSubmit(): [ReadonlySignal<Status>, () => void] {
  const status = signal<Status>("idle");
  let timer: ReturnType<typeof setTimeout> | undefined;
  getScope().onCleanup(() => clearTimeout(timer));
  const send = () => {
    status.value = "sending";
    timer = setTimeout(() => {
      status.value = "sent";
    }, MOCK_DELAY_MS);
  };
  return [status, send];
}

let nextFormId = 0;

const controlClass = "w-full rounded-land-md border border-land-border bg-land-surface px-land-hsp-sm text-land-body text-land-fg placeholder:text-land-faint aria-[invalid=true]:border-land-danger";
const formClass = "mx-auto flex w-full max-w-land-narrow flex-col gap-land-vsp-md rounded-land-md border border-land-border bg-land-surface p-land-hsp-md land-md:p-land-hsp-lg";

function Field({ id, label, error, children }: { id: string; label: string; error: ReadonlySignal<string | undefined>; children: Child }) {
  return (
    <div class="flex flex-col gap-land-vsp-xs">
      <label for={id} class="text-land-caption text-land-fg-strong">{label}</label>
      {children}
      <Show when={computed(() => Boolean(error.value))}>
        {() => <p id={`${id}-error`} class="text-land-caption text-land-danger">{error}</p>}
      </Show>
    </div>
  );
}

function errorProps(id: string, error: ReadonlySignal<string | undefined>) {
  return {
    "aria-invalid": computed(() => (error.value ? true : null)),
    "aria-describedby": computed(() => (error.value ? `${id}-error` : null)),
  };
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
  const id = `land-form-${nextFormId++}`;
  const email = signal("");
  const teamSize = signal("");
  const errors = signal<{ email?: string; teamSize?: string }>({});
  const [status, send] = mockSubmit();
  const sending = computed(() => status.value === "sending");
  const onSubmit = (event: Event) => {
    event.preventDefault();
    if (status.value !== "idle") return;
    const next = {
      ...(isEmail(email.value) ? {} : { email: "Enter a work email, like name@company.com." }),
      ...(teamSize.value ? {} : { teamSize: "Choose your team size." }),
    };
    errors.value = next;
    if (Object.keys(next).length === 0) send();
  };
  const emailId = `${id}-email`;
  const teamId = `${id}-team`;
  const emailError = computed(() => errors.value.email);
  const teamError = computed(() => errors.value.teamSize);
  return (
    <Show
      when={computed(() => status.value === "sent")}
      fallback={() => (
        <form novalidate on:submit={onSubmit} class={formClass}>
          <div class="flex flex-col gap-land-vsp-sm">
            <h2 class="text-land-h2-compact tracking-land-tight text-land-fg-strong land-md:text-land-h2">{heading}</h2>
            {lead && <p class="text-land-lead text-land-fg">{lead}</p>}
          </div>
          <Field id={emailId} label="Work email" error={emailError}>
            <input id={emailId} name="email" type="email" autocomplete="email" placeholder="name@company.com" modelValue={email} class={`h-land-control-h ${controlClass}`} {...errorProps(emailId, emailError)} />
          </Field>
          <Field id={teamId} label="Team size" error={teamError}>
            <select id={teamId} name="teamSize" modelValue={teamSize} class={`h-land-control-h ${controlClass}`} {...errorProps(teamId, teamError)}>
              <option value="">Choose a size</option>
              {TEAM_SIZES.map((size) => <option value={size}>{`${size} people`}</option>)}
            </select>
          </Field>
          <button type="submit" disabled={sending} class={`disabled:opacity-60 ${buttonClass("primary", "lg")}`}>
            {computed(() => (sending.value ? "Sending…" : buttonLabel))}
          </button>
          <DemoNote text={DEMO_NOTE} />
        </form>
      )}
    >
      {() => <SuccessPanel heading={successHeading} text={successText} />}
    </Show>
  );
}

export interface ContactFormProps {
  heading: string;
  successText: string;
}

export function ContactForm({ heading, successText }: ContactFormProps) {
  const id = `land-form-${nextFormId++}`;
  const values = { name: signal(""), email: signal(""), message: signal("") };
  const errors = signal<{ name?: string; email?: string; message?: string }>({});
  const [status, send] = mockSubmit();
  const sending = computed(() => status.value === "sending");
  const onSubmit = (event: Event) => {
    event.preventDefault();
    if (status.value !== "idle") return;
    const next = {
      ...(values.name.value.trim() ? {} : { name: "Tell us your name." }),
      ...(isEmail(values.email.value) ? {} : { email: "Enter an email we can reply to." }),
      ...(values.message.value.trim() ? {} : { message: "Write a short message." }),
    };
    errors.value = next;
    if (Object.keys(next).length === 0) send();
  };
  const nameId = `${id}-name`;
  const emailId = `${id}-email`;
  const messageId = `${id}-message`;
  const nameError = computed(() => errors.value.name);
  const emailError = computed(() => errors.value.email);
  const messageError = computed(() => errors.value.message);
  return (
    <Show
      when={computed(() => status.value === "sent")}
      fallback={() => (
        <form novalidate on:submit={onSubmit} class={formClass}>
          <h2 class="text-land-h3 text-land-fg-strong">{heading}</h2>
          <Field id={nameId} label="Name" error={nameError}>
            <input id={nameId} name="name" autocomplete="name" modelValue={values.name} class={`h-land-control-h ${controlClass}`} {...errorProps(nameId, nameError)} />
          </Field>
          <Field id={emailId} label="Email" error={emailError}>
            <input id={emailId} name="email" type="email" autocomplete="email" modelValue={values.email} class={`h-land-control-h ${controlClass}`} {...errorProps(emailId, emailError)} />
          </Field>
          <Field id={messageId} label="Message" error={messageError}>
            <textarea id={messageId} name="message" rows={5} modelValue={values.message} class={`py-land-vsp-xs ${controlClass}`} {...errorProps(messageId, messageError)} />
          </Field>
          <button type="submit" disabled={sending} class={`disabled:opacity-60 ${buttonClass("primary", "md")}`}>
            {computed(() => (sending.value ? "Sending…" : "Send message"))}
          </button>
          <DemoNote text={DEMO_NOTE} />
        </form>
      )}
    >
      {() => <SuccessPanel text={successText} />}
    </Show>
  );
}
