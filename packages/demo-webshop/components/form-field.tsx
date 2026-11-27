import { Show, computed, getScope, signal, type Child, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { CONTROL, FIELD_ERROR, FIELD_LABEL } from "./tone";

/** Every mock form "sends" after this fake delay (docs/demo-sites/webshop.md § 8). */
export const MOCK_DELAY_MS = 600;

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function formValues<K extends string>(form: HTMLFormElement, keys: readonly K[]): Record<K, string> {
  const data = new FormData(form);
  return Object.fromEntries(keys.map((key) => [key, String(data.get(key) ?? "")])) as Record<K, string>;
}

export type MockStatus = "idle" | "pending" | "done";

/** Validate → pending for the fake delay → done. The timer is dropped with the component's scope. */
export function mockSubmit<K extends string>(validate: (form: HTMLFormElement) => FieldErrors<K>, onDone?: () => void) {
  const status = signal<MockStatus>("idle");
  const errors = signal<FieldErrors<K>>({});
  let timer: ReturnType<typeof setTimeout> | undefined;
  getScope().onCleanup(() => clearTimeout(timer));

  const onSubmit = (event: Event) => {
    event.preventDefault();
    if (status.value !== "idle") return;
    const form = event.currentTarget as HTMLFormElement;
    const next = validate(form);
    errors.value = next;
    const firstInvalid = Object.keys(next)[0];
    if (firstInvalid) {
      form.querySelector<HTMLElement>(`[name="${firstInvalid}"]`)?.focus();
      return;
    }
    status.value = "pending";
    timer = setTimeout(() => {
      onDone?.();
      status.value = "done";
    }, MOCK_DELAY_MS);
  };

  return { status, errors, onSubmit };
}

/** One field's message out of a form's error signal. */
export function fieldError<K extends string>(errors: ReadonlySignal<FieldErrors<K>>, field: K): ReadonlySignal<string | undefined> {
  return computed(() => errors.value[field]);
}

interface FormFieldProps {
  id: string;
  name: string;
  label: string;
  error: ReadonlySignal<string | undefined>;
  type?: string;
  autocomplete?: string;
  inputmode?: "numeric" | "email" | "text";
  placeholder?: string;
  multiline?: boolean;
  children?: Child;
}

/** Label → control → inline error. `children` replaces the input (a `<select>`). */
export function FormField({ id, name, label, error, type = "text", autocomplete, inputmode, placeholder, multiline = false, children }: FormFieldProps) {
  const controlId = `${id}-${name}`;
  const errorId = `${controlId}-error`;
  const invalid = computed(() => (error.value ? true : null));
  const describedBy = computed(() => (error.value ? errorId : null));
  return (
    <div class="flex flex-col gap-shop-vsp-xs">
      <label for={controlId} class={FIELD_LABEL}>{label}</label>
      {children ?? (multiline ? (
        <textarea id={controlId} name={name} aria-invalid={invalid} aria-describedby={describedBy} rows={5} class="w-full px-shop-hsp-sm py-shop-vsp-xs border border-shop-border bg-shop-surface text-shop-fg-strong text-shop-body placeholder:text-shop-faint" />
      ) : (
        <input id={controlId} name={name} aria-invalid={invalid} aria-describedby={describedBy} type={type} autocomplete={autocomplete} inputmode={inputmode} placeholder={placeholder} class={`w-full ${CONTROL}`} />
      ))}
      <Show when={computed(() => Boolean(error.value))}>
        {() => <p id={errorId} class={FIELD_ERROR}>{error}</p>}
      </Show>
    </div>
  );
}

let nextFormId = 0;

/** A document-unique id prefix for one form's controls (replaces `useId`). */
export function formId(): string {
  return `shop-form-${nextFormId++}`;
}
