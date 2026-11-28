// The editor's Rename… dialog. The toolbar title is inline-editable, so this
// exists for the overflow menu's explicit entry — the discoverable route for
// anyone who never notices the name is a field.

import { computed, getScope, signal, type Child, type Ref } from "@takazudo/zfb/zudo-react";
import { Dialog } from "../../../../components/overlay";
import { read, type MaybeSignal } from "../../../../components/reactive";
import { Field, Input, isComposingKey } from "../../../../components/ui";

export interface ComposerRenameDialogProps {
  open: MaybeSignal<boolean>;
  /** The current name; the field is reset to it whenever the dialog opens. */
  value: MaybeSignal<string>;
  onSubmit: (name: string) => void;
  onClose: () => void;
}

export function ComposerRenameDialog({ open, value, onSubmit, onClose }: ComposerRenameDialogProps): Child {
  const fieldRef: Ref<HTMLInputElement> = { current: null };
  const draft = signal(read(value));
  const missing = signal(false);

  // Reset on the closed → open transition, in the same flush that mounts the
  // dialog's panel, so nothing typed into the opened field is replaced.
  let wasOpen = read(open);
  getScope().effect(() => {
    const isOpen = read(open);
    if (isOpen === wasOpen) return;
    wasOpen = isOpen;
    if (isOpen) {
      draft.value = read(value);
      missing.value = false;
    }
  });

  function submit(): void {
    const next = draft.value.trim();
    if (next === "") {
      missing.value = true;
      return;
    }
    onSubmit(next);
  }

  return (
    <Dialog
      open={open}
      title="Rename composition"
      initialFocusRef={fieldRef}
      onClose={onClose}
      footer={
        <>
          <button type="button" class="cms-dialog__action" on:click={() => onClose()}>
            Cancel
          </button>
          <button type="button" class="cms-dialog__action cms-dialog__action--primary" on:click={submit}>
            Save name
          </button>
        </>
      }
    >
      <Field label="Name" error={computed(() => (missing.value ? "Enter a composition name." : undefined))}>
        {(field) => (
          <Input
            field={field}
            elementRef={fieldRef}
            modelValue={draft}
            on:input={() => {
              missing.value = false;
            }}
            on:keydown={(event: KeyboardEvent) => {
              if (event.key !== "Enter" || isComposingKey(event)) return;
              event.preventDefault();
              submit();
            }}
          />
        )}
      </Field>
    </Dialog>
  );
}
