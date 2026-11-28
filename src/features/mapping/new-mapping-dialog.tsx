import { computed, getScope, Show, signal, type Child, type ReadonlySignal, type Ref } from "@takazudo/zfb/zudo-react";
import { Dialog } from "../../components/overlay";
import { read, type MaybeSignal } from "../../components/reactive";
import { Keyed } from "../../runtime";
import { Banner, Field, Input, isComposingKey, Select } from "../../components/ui";
import type { MappingEditorState } from "./controller";
import { refKey } from "./presentation";
import { followModel } from "./signals";

// Creating a Mapping: a name, the Content model it reads, the Composition it
// writes. The two selects carry PROVIDER-QUALIFIED RECORD IDS rather than list
// positions — a catalog that reloads or reorders between opening this dialog
// and submitting it would otherwise create the Mapping against a different
// record than the one the author picked.

type ContentModelEntry = MappingEditorState["contentModels"][number];
type CompositionEntry = MappingEditorState["compositions"][number];

export interface NewMappingDialogProps {
  open: MaybeSignal<boolean>;
  contentModels: MaybeSignal<readonly ContentModelEntry[]>;
  compositions: MaybeSignal<readonly CompositionEntry[]>;
  busy?: MaybeSignal<boolean>;
  /** A failed create; shown above the fields so the entered name survives it. */
  error?: MaybeSignal<string | null | undefined>;
  onSubmit: (name: string, contentModel: ContentModelEntry["ref"], composition: CompositionEntry["ref"]) => void;
  onClose: () => void;
}

const DEFAULT_NAME = "Untitled mapping";

/** A select over catalog entries, rebuilt whenever the option list changes; the model follows the resolved choice. */
function CatalogSelect<Entry extends { ref: { providerId: string; recordId: string } }>({ entries, selected, disabled, field, label, onChoose }: {
  entries: ReadonlySignal<readonly Entry[]>;
  selected: ReadonlySignal<Entry | undefined>;
  disabled: ReadonlySignal<boolean>;
  field: Parameters<typeof Select>[0]["field"];
  label: (entry: Entry) => string;
  onChoose: (key: string) => void;
}): Child {
  const optionsKey = computed(() => entries.value.map((entry) => `${refKey(entry.ref)}\u0000${label(entry)}`).join("\u0001"));
  return <Keyed value={optionsKey} by={(key) => key}>{() => {
    const model = followModel(() => (selected.value === undefined ? "" : refKey(selected.value.ref)));
    return (
      <Select field={field} modelValue={model} disabled={disabled} on:change={(event) => onChoose(event.currentTarget.value)}>
        {entries.value.map((entry) => <option key={refKey(entry.ref)} value={refKey(entry.ref)}>{label(entry)}</option>)}
      </Select>
    );
  }}</Keyed>;
}

export function NewMappingDialog({
  open,
  contentModels,
  compositions,
  busy = false,
  error,
  onSubmit,
  onClose,
}: NewMappingDialogProps): Child {
  const nameRef: Ref<HTMLInputElement> = { current: null };
  const name = signal(DEFAULT_NAME);
  const missing = signal(false);
  const contentKey = signal("");
  const compositionKey = signal("");
  const isOpen = computed(() => read(open));
  const isBusy = computed(() => read(busy));
  const models = computed(() => read(contentModels));
  const targets = computed(() => read(compositions));

  // Each opening starts from the defaults. The effect lands in the same flush
  // that opens the dialog, before the browser can deliver a keystroke into it.
  let wasOpen = isOpen.value;
  getScope().effect(() => {
    const now = isOpen.value;
    if (now === wasOpen) return;
    wasOpen = now;
    if (!now) return;
    name.value = DEFAULT_NAME;
    missing.value = false;
    contentKey.value = "";
    compositionKey.value = "";
  });

  // An unset select shows the first entry, so that is what an untouched
  // submission means. Resolving through the list rather than storing the
  // default keeps the two in step when the catalog arrives after the open.
  const contentModel = computed(() => models.value.find((entry) => refKey(entry.ref) === contentKey.value) ?? models.value[0]);
  const composition = computed(() => targets.value.find((entry) => refKey(entry.ref) === compositionKey.value) ?? targets.value[0]);
  const ready = computed(() => !isBusy.value && contentModel.value !== undefined && composition.value !== undefined);
  const errorText = computed(() => read(error) ?? null);

  function submit(): void {
    if (!ready.value) return;
    const trimmed = name.value.trim();
    if (trimmed === "") {
      missing.value = true;
      return;
    }
    missing.value = false;
    onSubmit(trimmed, contentModel.value!.ref, composition.value!.ref);
  }

  return (
    <Dialog
      open={isOpen}
      title="Create mapping"
      initialFocusRef={nameRef}
      dismissOnBackdrop={computed(() => !isBusy.value)}
      onClose={() => {
        if (!isBusy.value) onClose();
      }}
      footer={
        <>
          <button type="button" class="cms-dialog__action" disabled={isBusy} on:click={() => onClose()}>
            Cancel
          </button>
          <button type="button" class="cms-dialog__action cms-dialog__action--primary" disabled={computed(() => !ready.value)} on:click={submit}>
            {computed(() => (isBusy.value ? "Working…" : "Create"))}
          </button>
        </>
      }
    >
      <p class="cms-dialog__message">A mapping reads one Content model and writes one Composition.</p>
      <Show when={computed(() => Boolean(errorText.value))}>{() => <Banner tone="err">{computed(() => errorText.value ?? "")}</Banner>}</Show>
      <Field label="Name" error={computed(() => (missing.value ? "Enter a mapping name." : undefined))}>
        {(field) => (
          <Input
            field={field}
            elementRef={nameRef}
            modelValue={name}
            autocomplete="off"
            disabled={isBusy}
            on:input={() => { missing.value = false; }}
            on:keydown={(event: KeyboardEvent) => {
              if (event.key !== "Enter" || isComposingKey(event)) return;
              event.preventDefault();
              submit();
            }}
          />
        )}
      </Field>
      <Field label="Content model" help="The source Entries this Mapping reads.">
        {(field) => (
          <CatalogSelect
            field={field}
            entries={models}
            selected={contentModel}
            disabled={computed(() => isBusy.value || models.value.length === 0)}
            label={(entry) => `${entry.summary.name} · ${entry.summary.kind} · ${entry.providerLabel}`}
            onChoose={(key) => { contentKey.value = key; }}
          />
        )}
      </Field>
      <Field label="Composition" help="The target this Mapping writes into.">
        {(field) => (
          <CatalogSelect
            field={field}
            entries={targets}
            selected={composition}
            disabled={computed(() => isBusy.value || targets.value.length === 0)}
            label={(entry) => `${entry.summary.name} · ${entry.providerLabel}`}
            onChoose={(key) => { compositionKey.value = key; }}
          />
        )}
      </Field>
    </Dialog>
  );
}
