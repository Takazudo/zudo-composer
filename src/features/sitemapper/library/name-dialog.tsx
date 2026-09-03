/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Dialog } from "../../../components/overlay";
import { Banner, Field, Input } from "../../../components/ui";

// The one naming question the Sitemapper asks — creating a Sitemap, renaming
// one, renaming a page. It is the shared `Dialog` rather than a native
// `prompt()`, and an empty name is answered inline instead of through the
// browser's constraint bubble, so the wording is ours and the dialog stays put
// with the text the author typed.

export interface SitemapNameDialogProps {
  open: boolean;
  title: string;
  description: string;
  /** Accessible name of the field, e.g. "Sitemap name". */
  label: string;
  submitLabel: string;
  initialValue: string;
  busy?: boolean;
  /** A failed save; shown above the field so the entered name survives it. */
  error?: string | null;
  requiredMessage?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}

export function SitemapNameDialog({
  open,
  title,
  description,
  label,
  submitLabel,
  initialValue,
  busy = false,
  error,
  requiredMessage,
  onSubmit,
  onClose,
}: SitemapNameDialogProps): JSX.Element {
  // `Input` omits `ref` from its props, so the field is reached through its
  // wrapper. Preact assigns refs before it flushes layout effects, which is
  // what lets `Dialog` find the input on the render that opens it.
  const fieldRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState(initialValue);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    setMissing(false);
  }, [open, initialValue]);

  function submit(): void {
    if (busy) return;
    const next = value.trim();
    if (next === "") {
      setMissing(true);
      return;
    }
    setMissing(false);
    onSubmit(next);
  }

  return (
    <Dialog
      open={open}
      title={title}
      initialFocusRef={fieldRef}
      dismissOnBackdrop={!busy}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <button type="button" class="cms-dialog__action" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" class="cms-dialog__action cms-dialog__action--primary" disabled={busy} onClick={submit}>
            {busy ? "Working…" : submitLabel}
          </button>
        </>
      }
    >
      <p class="cms-dialog__message">{description}</p>
      {error ? <Banner tone="err">{error}</Banner> : null}
      <div
        ref={(element) => {
          fieldRef.current = element?.querySelector("input") ?? null;
        }}
      >
        <Field label={label} error={missing ? (requiredMessage ?? `Enter a ${label.toLowerCase()}.`) : undefined}>
          <Input
            value={value}
            autocomplete="off"
            disabled={busy}
            onInput={(event) => {
              setMissing(false);
              setValue(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              submit();
            }}
          />
        </Field>
      </div>
    </Dialog>
  );
}
