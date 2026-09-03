import type { JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { Dialog } from "../../components/overlay";
import { Banner, Field, Input, SegmentedControl } from "../../components/ui";
import type { ContentModelKind } from "../../content";

// Creating a Content model is one question with two answers — what it is called
// and whether it holds many Entries or one — so it is asked once, in the shared
// `Dialog`, instead of by two "New …" buttons that create an "Untitled" record
// the author then has to find and rename.

export interface ContentAddModelDialogProps {
  open: boolean;
  busy?: boolean;
  /** A failed create; shown above the field so the typed name survives it. */
  error?: string | null;
  onSubmit(name: string, kind: ContentModelKind): void;
  onClose(): void;
}

const KIND_OPTIONS = [
  { value: "collection" as const, label: "Collection" },
  { value: "single" as const, label: "Single" },
];

export function ContentAddModelDialog({ open, busy = false, error, onSubmit, onClose }: ContentAddModelDialogProps): JSX.Element {
  // `Input` omits `ref` from its props, so the field is reached through its
  // wrapper; Preact assigns refs before it flushes layout effects, which is
  // what lets `Dialog` find the input on the render that opens it.
  const fieldRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ContentModelKind>("collection");
  const [missing, setMissing] = useState(false);

  // Reset during the opening render, NOT in an effect: an effect runs after
  // paint, so the dialog is visible and typeable for a frame before the reset
  // lands and anything typed in that window is silently clobbered.
  const wasOpen = useRef(open);
  if (open !== wasOpen.current) {
    wasOpen.current = open;
    if (open) {
      setName("");
      setKind("collection");
      setMissing(false);
    }
  }

  function submit(): void {
    if (busy) return;
    const next = name.trim();
    if (next === "") {
      setMissing(true);
      return;
    }
    setMissing(false);
    onSubmit(next, kind);
  }

  return (
    <Dialog
      open={open}
      title="Add Content model"
      initialFocusRef={fieldRef}
      dismissOnBackdrop={!busy}
      onClose={() => { if (!busy) onClose(); }}
      footer={
        <>
          <button type="button" class="cms-dialog__action" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" class="cms-dialog__action cms-dialog__action--primary" disabled={busy} onClick={submit}>
            {busy ? "Working…" : "Add model"}
          </button>
        </>
      }
    >
      <p class="cms-dialog__message">A Collection holds many Entries; a Single holds exactly one workspace.</p>
      {error ? <Banner tone="err">{error}</Banner> : null}
      <div ref={(element) => { fieldRef.current = element?.querySelector("input") ?? null; }}>
        <Field label="Model name" error={missing ? "Enter a model name." : undefined}>
          <Input
            value={name}
            autocomplete="off"
            disabled={busy}
            onInput={(event) => { setMissing(false); setName(event.currentTarget.value); }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              submit();
            }}
          />
        </Field>
      </div>
      <SegmentedControl<ContentModelKind>
        label="Model kind"
        value={kind}
        onChange={setKind}
        options={KIND_OPTIONS}
      />
    </Dialog>
  );
}
