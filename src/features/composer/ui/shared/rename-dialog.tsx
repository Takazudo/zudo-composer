/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The editor's Rename… dialog. The toolbar title is inline-editable, so this
// exists for the overflow menu's explicit entry — the discoverable route for
// anyone who never notices the name is a field.

import type { JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { Dialog } from "../../../../components/overlay";
import { Field, Input } from "../../../../components/ui";

export interface ComposerRenameDialogProps {
  open: boolean;
  /** The current name; the field is reset to it whenever the dialog opens. */
  value: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}

export function ComposerRenameDialog({ open, value, onSubmit, onClose }: ComposerRenameDialogProps): JSX.Element {
  const fieldRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(value);
  const [missing, setMissing] = useState(false);

  // Reset during render, not in an effect: an effect runs after paint, so the
  // dialog would be visible and typeable for a frame before the reset landed,
  // and anything typed in that window would be silently replaced.
  const wasOpen = useRef(open);
  if (open !== wasOpen.current) {
    wasOpen.current = open;
    if (open) {
      setDraft(value);
      setMissing(false);
    }
  }

  function submit(): void {
    const next = draft.trim();
    if (next === "") {
      setMissing(true);
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
          <button type="button" class="cms-dialog__action" onClick={onClose}>
            Cancel
          </button>
          <button type="button" class="cms-dialog__action cms-dialog__action--primary" onClick={submit}>
            Save name
          </button>
        </>
      }
    >
      <Field label="Name" error={missing ? "Enter a composition name." : undefined}>
        <Input
          elementRef={fieldRef}
          value={draft}
          onInput={(event) => {
            setMissing(false);
            setDraft(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            submit();
          }}
        />
      </Field>
    </Dialog>
  );
}
