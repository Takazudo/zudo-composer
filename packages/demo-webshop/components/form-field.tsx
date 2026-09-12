import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
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

/** Validate → pending for the fake delay → done. The timer is dropped on unmount. */
export function useMockSubmit<K extends string>(validate: (form: HTMLFormElement) => FieldErrors<K>, onDone?: () => void) {
  const [status, setStatus] = useState<MockStatus>("idle");
  const [errors, setErrors] = useState<FieldErrors<K>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const onSubmit = (event: Event) => {
    event.preventDefault();
    if (status !== "idle") return;
    const form = event.currentTarget as HTMLFormElement;
    const next = validate(form);
    setErrors(next);
    const firstInvalid = Object.keys(next)[0];
    if (firstInvalid) {
      form.querySelector<HTMLElement>(`[name="${firstInvalid}"]`)?.focus();
      return;
    }
    setStatus("pending");
    timer.current = setTimeout(() => {
      onDone?.();
      setStatus("done");
    }, MOCK_DELAY_MS);
  };

  return { status, errors, onSubmit };
}

interface FormFieldProps {
  id: string;
  name: string;
  label: string;
  error?: string;
  type?: string;
  autoComplete?: string;
  inputMode?: "numeric" | "email" | "text";
  placeholder?: string;
  multiline?: boolean;
  children?: ComponentChildren;
}

/** Label → control → inline error. `children` replaces the input (a `<select>`). */
export function FormField({ id, name, label, error, type = "text", autoComplete, inputMode, placeholder, multiline = false, children }: FormFieldProps) {
  const controlId = `${id}-${name}`;
  const errorId = `${controlId}-error`;
  const shared = {
    id: controlId,
    name,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? errorId : undefined,
  };
  return (
    <div class="flex flex-col gap-shop-vsp-xs">
      <label for={controlId} class={FIELD_LABEL}>{label}</label>
      {children ?? (multiline ? (
        <textarea {...shared} rows={5} class="w-full px-shop-hsp-sm py-shop-vsp-xs border border-shop-border bg-shop-surface text-shop-fg-strong text-shop-body placeholder:text-shop-faint" />
      ) : (
        <input {...shared} type={type} autoComplete={autoComplete} inputMode={inputMode} placeholder={placeholder} class={`w-full ${CONTROL}`} />
      ))}
      {error && <p id={errorId} class={FIELD_ERROR}>{error}</p>}
    </div>
  );
}
