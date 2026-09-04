/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { Dialog } from "../../components/overlay";
import { Banner, Field, Input, Select } from "../../components/ui";
import type { MappingEditorState } from "./controller";
import { refKey } from "./presentation";

// Creating a Mapping: a name, the Content model it reads, the Composition it
// writes. The two selects carry PROVIDER-QUALIFIED RECORD IDS rather than list
// positions — a catalog that reloads or reorders between opening this dialog
// and submitting it would otherwise create the Mapping against a different
// record than the one the author picked.

type ContentModelEntry = MappingEditorState["contentModels"][number];
type CompositionEntry = MappingEditorState["compositions"][number];

export interface NewMappingDialogProps {
  open: boolean;
  contentModels: readonly ContentModelEntry[];
  compositions: readonly CompositionEntry[];
  busy?: boolean;
  /** A failed create; shown above the fields so the entered name survives it. */
  error?: string | null;
  onSubmit: (name: string, contentModel: ContentModelEntry["ref"], composition: CompositionEntry["ref"]) => void;
  onClose: () => void;
}

const DEFAULT_NAME = "Untitled mapping";

export function NewMappingDialog({
  open,
  contentModels,
  compositions,
  busy = false,
  error,
  onSubmit,
  onClose,
}: NewMappingDialogProps): JSX.Element {
  const nameRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState(DEFAULT_NAME);
  const [missing, setMissing] = useState(false);
  const [contentKey, setContentKey] = useState("");
  const [compositionKey, setCompositionKey] = useState("");

  // Reset during the opening render, NOT in an effect: an effect runs after
  // paint, so the dialog would be typeable for a frame before the reset lands
  // and anything entered in that window is silently clobbered.
  const wasOpen = useRef(open);
  if (open !== wasOpen.current) {
    wasOpen.current = open;
    if (open) {
      setName(DEFAULT_NAME);
      setMissing(false);
      setContentKey("");
      setCompositionKey("");
    }
  }

  // An unset select shows the first entry, so that is what an untouched
  // submission means. Resolving through the list rather than storing the
  // default keeps the two in step when the catalog arrives after the open.
  const contentModel = contentModels.find((entry) => refKey(entry.ref) === contentKey) ?? contentModels[0];
  const composition = compositions.find((entry) => refKey(entry.ref) === compositionKey) ?? compositions[0];
  const ready = !busy && contentModel !== undefined && composition !== undefined;

  function submit(): void {
    if (!ready) return;
    const trimmed = name.trim();
    if (trimmed === "") {
      setMissing(true);
      return;
    }
    setMissing(false);
    onSubmit(trimmed, contentModel.ref, composition.ref);
  }

  return (
    <Dialog
      open={open}
      title="Create mapping"
      initialFocusRef={nameRef}
      dismissOnBackdrop={!busy}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <button type="button" class="cms-dialog__action" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" class="cms-dialog__action cms-dialog__action--primary" disabled={!ready} onClick={submit}>
            {busy ? "Working…" : "Create"}
          </button>
        </>
      }
    >
      <p class="cms-dialog__message">A mapping reads one Content model and writes one Composition.</p>
      {error ? <Banner tone="err">{error}</Banner> : null}
      <Field label="Name" error={missing ? "Enter a mapping name." : undefined}>
        <Input
          elementRef={nameRef}
          value={name}
          autocomplete="off"
          disabled={busy}
          onInput={(event) => {
            setMissing(false);
            setName(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            submit();
          }}
        />
      </Field>
      <Field label="Content model" help="The source Entries this Mapping reads.">
        <Select
          value={contentModel === undefined ? "" : refKey(contentModel.ref)}
          disabled={busy || contentModels.length === 0}
          onChange={(event) => setContentKey(event.currentTarget.value)}
        >
          {contentModels.map((entry) => (
            <option key={refKey(entry.ref)} value={refKey(entry.ref)}>
              {entry.summary.name} · {entry.summary.kind} · {entry.providerLabel}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Composition" help="The target this Mapping writes into.">
        <Select
          value={composition === undefined ? "" : refKey(composition.ref)}
          disabled={busy || compositions.length === 0}
          onChange={(event) => setCompositionKey(event.currentTarget.value)}
        >
          {compositions.map((entry) => (
            <option key={refKey(entry.ref)} value={refKey(entry.ref)}>
              {entry.summary.name} · {entry.providerLabel}
            </option>
          ))}
        </Select>
      </Field>
    </Dialog>
  );
}
