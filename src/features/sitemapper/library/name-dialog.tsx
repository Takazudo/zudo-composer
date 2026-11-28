import { computed, getScope, Show, signal, type Child } from "@takazudo/zfb/zudo-react";
import { Dialog } from "../../../components/overlay";
import { toSignal, type MaybeSignal } from "../../../components/reactive";
import { Banner, Field, Input, isComposingKey } from "../../../components/ui";

// The one naming question the Sitemapper asks — creating a Sitemap, renaming
// one, renaming a page. It is the shared `Dialog` rather than a native
// `prompt()`, and an empty name is answered inline instead of through the
// browser's constraint bubble, so the wording is ours and the dialog stays put
// with the text the author typed.

export interface SitemapNameDialogProps {
  open: MaybeSignal<boolean>;
  title: MaybeSignal<string>;
  description: MaybeSignal<string>;
  /** Accessible name of the field, e.g. "Sitemap name". */
  label: MaybeSignal<string>;
  submitLabel: MaybeSignal<string>;
  /** Read when the dialog opens. */
  initialValue: MaybeSignal<string>;
  busy?: MaybeSignal<boolean>;
  /** A failed save; shown above the field so the entered name survives it. */
  error?: MaybeSignal<string | null | undefined>;
  requiredMessage?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}

export function SitemapNameDialog({
  open: openInput,
  title,
  description,
  label: labelInput,
  submitLabel: submitInput,
  initialValue: initialInput,
  busy: busyInput = false,
  error: errorInput,
  requiredMessage,
  onSubmit,
  onClose,
}: SitemapNameDialogProps): Child {
  const open = toSignal(openInput);
  const initialValue = toSignal(initialInput);
  const label = toSignal(labelInput);
  const busy = toSignal(busyInput);
  const submitLabel = toSignal(submitInput);
  const error = toSignal(errorInput);
  const fieldRef: { current: HTMLInputElement | null } = { current: null };
  const value = signal(initialValue.value);
  const missing = signal(false);

  // Reset on the opening transition, registered before the dialog's own open
  // effect, so the field holds the initial value before it can be typed into.
  // (The coarse-lane browser spec fills the field as soon as it is shown; a
  // reset that landed later would clobber what it typed.)
  let wasOpen = open.value;
  getScope().effect(() => {
    const isOpen = open.value;
    const initial = initialValue.value;
    if (isOpen === wasOpen) return;
    wasOpen = isOpen;
    if (isOpen) {
      value.value = initial;
      missing.value = false;
    }
  });

  function submit(): void {
    if (busy.value) return;
    const next = value.value.trim();
    if (next === "") {
      missing.value = true;
      return;
    }
    missing.value = false;
    onSubmit(next);
  }

  return (
    <Dialog
      open={open}
      title={title}
      initialFocusRef={fieldRef}
      dismissOnBackdrop={computed(() => !busy.value)}
      onClose={() => {
        if (!busy.value) onClose();
      }}
      footer={
        <>
          <button type="button" class="cms-dialog__action" disabled={busy} on:click={onClose}>
            Cancel
          </button>
          <button type="button" class="cms-dialog__action cms-dialog__action--primary" disabled={busy} on:click={submit}>
            {computed(() => (busy.value ? "Working…" : submitLabel.value))}
          </button>
        </>
      }
    >
      <p class="cms-dialog__message">{description}</p>
      <Show when={computed(() => !!error.value)}>{() => <Banner tone="err">{computed(() => error.value ?? "")}</Banner>}</Show>
      <div>
        <Field
          label={label}
          error={computed(() => (missing.value ? (requiredMessage ?? `Enter a ${label.value.toLowerCase()}.`) : null))}
        >
          {(field) => (
            <Input
              field={field}
              elementRef={fieldRef}
              modelValue={value}
              autocomplete="off"
              disabled={busy}
              on:input={() => { missing.value = false; }}
              on:keydown={(event: KeyboardEvent) => {
                if (event.key !== "Enter" || isComposingKey(event)) return;
                event.preventDefault();
                submit();
              }}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
