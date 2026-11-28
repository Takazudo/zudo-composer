import { computed, getScope, Show, signal, type Ref } from "@takazudo/zfb/zudo-react";
import { Dialog } from "../../components/overlay";
import { read, type MaybeSignal } from "../../components/reactive";
import { Banner, Field, Input, SegmentedControl } from "../../components/ui";
import type { ContentModelKind } from "../../content";

// Creating a Content model is one question with two answers — what it is called
// and whether it holds many Entries or one — so it is asked once, in the shared
// `Dialog`, instead of by two "New …" buttons that create an "Untitled" record
// the author then has to find and rename.

export interface ContentAddModelDialogProps {
  open: MaybeSignal<boolean>;
  busy?: MaybeSignal<boolean>;
  /** A failed create; shown above the field so the typed name survives it. */
  error?: MaybeSignal<string | null | undefined>;
  onSubmit(name: string, kind: ContentModelKind): void;
  onClose(): void;
}

const KIND_OPTIONS = [
  { value: "collection" as const, label: "Collection" },
  { value: "single" as const, label: "Single" },
];

export function ContentAddModelDialog({ open, busy = false, error, onSubmit, onClose }: ContentAddModelDialogProps) {
  const scope = getScope();
  const fieldRef: Ref<HTMLInputElement> = { current: null };
  const name = signal("");
  const kind = signal<ContentModelKind>("collection");
  const missing = signal(false);
  const isBusy = computed(() => Boolean(read(busy)));
  const errorText = computed(() => read(error) ?? null);

  // Each opening starts blank, reset in the same flush that shows the panel.
  let wasOpen = read(open);
  scope.effect(() => {
    const now = read(open);
    if (now === wasOpen) return;
    wasOpen = now;
    if (now) {
      name.value = "";
      kind.value = "collection";
      missing.value = false;
    }
  });

  function submit(): void {
    if (isBusy.value) return;
    const next = name.value.trim();
    if (next === "") {
      missing.value = true;
      return;
    }
    missing.value = false;
    onSubmit(next, kind.value);
  }

  return (
    <Dialog
      open={open}
      title="Add Content model"
      initialFocusRef={fieldRef}
      dismissOnBackdrop={computed(() => !isBusy.value)}
      onClose={() => { if (!isBusy.value) onClose(); }}
      footer={
        <>
          <button type="button" class="cms-dialog__action" disabled={isBusy} on:click={onClose}>Cancel</button>
          <button type="button" class="cms-dialog__action cms-dialog__action--primary" disabled={isBusy} on:click={submit}>
            {computed(() => (isBusy.value ? "Working…" : "Add model"))}
          </button>
        </>
      }
    >
      <p class="cms-dialog__message">A Collection holds many Entries; a Single holds exactly one workspace.</p>
      <Show when={computed(() => Boolean(errorText.value))}>{() => <Banner tone="err">{computed(() => errorText.value ?? "")}</Banner>}</Show>
      <Field label="Model name" error={computed(() => (missing.value ? "Enter a model name." : undefined))}>
        {(control) => (
          <Input
            field={control}
            elementRef={fieldRef}
            modelValue={name}
            autocomplete="off"
            disabled={isBusy}
            on:input={() => { missing.value = false; }}
            on:keydown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              submit();
            }}
          />
        )}
      </Field>
      <SegmentedControl<ContentModelKind>
        label="Model kind"
        value={kind}
        onChange={(next) => { kind.value = next; }}
        options={KIND_OPTIONS}
      />
    </Dialog>
  );
}
