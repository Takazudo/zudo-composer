import { computed, For, getScope, Show, signal, type Child, type Ref } from "@takazudo/zfb/zudo-react";
import { ChevronDownIcon, ChevronUpIcon, SearchIcon, XMarkIcon } from "../../components/icons";
import { Dialog } from "../../components/overlay";
import { toSignal, type MaybeSignal } from "../../components/reactive";
import { Button, Checkbox, EmptyState, Input } from "../../components/ui";
import type { ContentEntryRecord, ContentModelRecord } from "../../content";
import type { MappingCollectionPin } from "../../mapping";
import type { MappingCollectionQuery } from "../../mapping";
import { entryLabel } from "./presentation";

export interface PinPickerDialogProps {
  open: MaybeSignal<boolean>;
  entries: MaybeSignal<readonly ContentEntryRecord[]>;
  model: MaybeSignal<ContentModelRecord | null>;
  providerId: MaybeSignal<string>;
  currentPins: MaybeSignal<readonly MappingCollectionPin[]>;
  publication: MaybeSignal<MappingCollectionQuery["publication"]>;
  onSave: (pins: readonly MappingCollectionPin[]) => void;
  onClose: () => void;
}

function pinKey(pin: Pick<MappingCollectionPin, "providerId" | "modelId" | "recordId">): string {
  return `${pin.providerId}\u0000${pin.modelId}\u0000${pin.recordId}`;
}

export function PinPickerDialog(props: PinPickerDialogProps): Child {
  const { onSave, onClose } = props;
  const open = toSignal(props.open);
  const entries = toSignal(props.entries);
  const model = toSignal(props.model);
  const providerId = toSignal(props.providerId);
  const currentPins = toSignal(props.currentPins);
  const publication = toSignal(props.publication);
  const searchRef: Ref<HTMLInputElement> = { current: null };
  const search = signal("");
  const pins = signal<MappingCollectionPin[]>([...currentPins.value]);
  let wasOpen = open.value;
  getScope().effect(() => {
    const next = open.value;
    if (next === wasOpen) return;
    wasOpen = next;
    if (next) {
      search.value = "";
      pins.value = [...currentPins.value];
    }
  });

  const entryPinKey = (entry: ContentEntryRecord) => pinKey({ providerId: providerId.value, modelId: entry.modelId, recordId: entry.id });
  const catalog = computed(() => {
    const pinned = new Set(pins.value.map(pinKey));
    const modelEntries = entries.value.filter((entry) => entry.modelId === model.value?.id);
    return [...modelEntries.filter((entry) => pinned.has(entryPinKey(entry))), ...modelEntries.filter((entry) => !pinned.has(entryPinKey(entry))).sort((left, right) => left.id.localeCompare(right.id))];
  });
  const visible = computed(() => catalog.value.filter((entry) => `${entry.id} ${entryLabel(entry, model.value)}`.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())));
  const stale = computed(() => {
    const modelId = model.value?.id;
    return pins.value.filter((pin) => pin.providerId !== providerId.value || pin.modelId !== modelId || !entries.value.some((entry) => entry.id === pin.recordId && entry.modelId === modelId && (publication.value === "include-drafts" || entry.lifecycle !== "draft")));
  });

  function toggle(entry: ContentEntryRecord, checked: boolean): void {
    const key = entryPinKey(entry);
    if (checked) {
      if (pins.value.some((pin) => pinKey(pin) === key)) return;
      pins.value = [...pins.value, { providerId: providerId.value, modelId: entry.modelId, recordId: entry.id }];
    } else {
      pins.value = pins.value.filter((pin) => pinKey(pin) !== key);
    }
  }

  function move(index: number, direction: -1 | 1): void {
    const next = index + direction;
    if (next < 0 || next >= pins.value.length) return;
    const reordered = [...pins.value];
    [reordered[index], reordered[next]] = [reordered[next]!, reordered[index]!];
    pins.value = reordered;
  }

  return (
    <Dialog
      open={open}
      title="Choose ordered pins"
      class="cms-mapping-pin-picker"
      initialFocusRef={searchRef}
      onClose={onClose}
      footer={<><Button variant="ghost" on:click={onClose}>Cancel</Button><Button variant="primary" on:click={() => { onSave(pins.value); onClose(); }}>Save pins</Button></>}
    >
      <p class="cms-dialog__message">Pins come from the complete current source catalog. Stale or ineligible pins remain visible in Diagnostics.</p>
      <Input elementRef={searchRef} type="search" icon={SearchIcon} aria-label="Filter source Entries" placeholder={computed(() => `Search ${catalog.value.length} Entries…`)} modelValue={search} />
      <Show when={computed(() => model.value === null)}>{() => <EmptyState inline icon={SearchIcon} title="Resolve a collection Content model first." />}</Show>
      <Show when={computed(() => model.value !== null && catalog.value.length === 0)}>{() => <EmptyState inline icon={SearchIcon} title="No eligible Entries in the source catalog." />}</Show>
      <Show when={computed(() => stale.value.length > 0)}>{() => <section class="cms-mapping-pin-picker__stale"><strong>Stale pins</strong><For each={stale} by={pinKey}>{(pin) => <div><span>{computed(() => pin.value.recordId)}</span><Button iconOnly variant="ghost" size="sm" aria-label={computed(() => `Remove stale pin ${pin.value.recordId}`)} on:click={() => { const key = pinKey(pin.value); pins.value = pins.value.filter((candidate) => pinKey(candidate) !== key); }}><XMarkIcon size="sm" /></Button></div>}</For></section>}</Show>
      <Show when={computed(() => visible.value.length > 0)}>{() => <ul class="cms-mapping-pin-picker__catalog"><For each={visible} by={(entry) => entry.id}>{(entry) => <li><Checkbox disabled={computed(() => publication.value === "published-only" && entry.value.lifecycle === "draft")} label={<><strong>{computed(() => entryLabel(entry.value, model.value))}</strong><code>{computed(() => `${entry.value.id}${entry.value.lifecycle === "draft" ? " · draft" : ""}`)}</code></>} checked={computed(() => pins.value.some((pin) => pinKey(pin) === entryPinKey(entry.value)))} onCheckedChange={(checked) => toggle(entry.value, checked)} /></li>}</For></ul>}</Show>
      <Show when={computed(() => pins.value.length > 0)}>{() => <section class="cms-mapping-pin-picker__order"><h3>Pin order</h3><ol><For each={pins} by={pinKey}>{(pin, index) => {
        const entry = computed(() => pin.value.providerId === providerId.value ? entries.value.find((candidate) => candidate.id === pin.value.recordId && candidate.modelId === pin.value.modelId) : undefined);
        return <li><span>{computed(() => entry.value ? entryLabel(entry.value, model.value) : pin.value.recordId)}</span><span class="cms-mapping-pin-picker__order-actions"><Button iconOnly variant="ghost" size="sm" disabled={computed(() => index.value === 0)} aria-label={computed(() => `Move pin ${pin.value.recordId} up`)} on:click={() => move(index.value, -1)}><ChevronUpIcon size="sm" /></Button><Button iconOnly variant="ghost" size="sm" disabled={computed(() => index.value === pins.value.length - 1)} aria-label={computed(() => `Move pin ${pin.value.recordId} down`)} on:click={() => move(index.value, 1)}><ChevronDownIcon size="sm" /></Button></span></li>;
      }}</For></ol></section>}</Show>
    </Dialog>
  );
}
