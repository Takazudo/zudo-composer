import { computed, getScope, Show, signal, type Child, type Ref } from "@takazudo/zfb/zudo-react";
import { SearchIcon, type IconComponent } from "../../components/icons";
import { matchesLibrarySearch } from "../../components/library-page";
import { Dialog } from "../../components/overlay";
import { toSignal, type MaybeSignal } from "../../components/reactive";
import { Rebuild } from "../../components/rebuild";
import { Button, EmptyState, Input } from "../../components/ui";
import { derive, memo } from "./signals";

// The toolbar's two source/target pickers. They replace the editor's old
// `<select>` pair: a catalog is a list of records to search, not a dropdown to
// scroll, and both sides of a Mapping deserve the provider label and the
// record id an option row cannot carry.

export interface RecordPickerEntry {
  /** Provider-qualified key; what `onSelect` hands back. */
  readonly key: string;
  readonly name: string;
  /** The line under the name — kind, provider, record id. */
  readonly detail: string;
  readonly icon?: IconComponent;
}

export interface RecordPickerDialogProps {
  open: MaybeSignal<boolean>;
  title: string;
  /** One line saying what picking here changes. */
  description: string;
  searchLabel: string;
  entries: MaybeSignal<readonly RecordPickerEntry[]>;
  /** The record in force; its row is marked and inert. */
  currentKey: MaybeSignal<string>;
  emptyMessage: string;
  onSelect: (key: string) => void;
  onClose: () => void;
}

export function RecordPickerDialog({
  open,
  title,
  description,
  searchLabel,
  entries,
  currentKey,
  emptyMessage,
  onSelect,
  onClose,
}: RecordPickerDialogProps): Child {
  const isOpen = toSignal(open);
  const entryList = toSignal(entries);
  const current = toSignal(currentKey);
  const searchRef: Ref<HTMLInputElement> = { current: null };
  const search = signal("");

  // Every opening starts from an empty search; see `NewMappingDialog`.
  let wasOpen = isOpen.value;
  getScope().effect(() => {
    const next = isOpen.value;
    if (next === wasOpen) return;
    wasOpen = next;
    if (next) search.value = "";
  });

  const visible = derive(() => [entryList.value, search.value] as const, (list, text) => list.filter((entry) => matchesLibrarySearch(`${entry.name} ${entry.detail}`, text)));

  return (
    <Dialog
      open={isOpen}
      title={title}
      class="cms-mapping-picker"
      initialFocusRef={searchRef}
      onClose={onClose}
      footer={
        <button type="button" class="cms-dialog__action" on:click={() => onClose()}>
          Cancel
        </button>
      }
    >
      <p class="cms-dialog__message">{description}</p>
      <Input
        elementRef={searchRef}
        type="search"
        icon={SearchIcon}
        modelValue={search}
        aria-label={searchLabel}
        placeholder={computed(() => `Search ${entryList.value.length} ${entryList.value.length === 1 ? "record" : "records"}…`)}
      />
      <Show when={computed(() => entryList.value.length === 0)}>{() => <EmptyState inline icon={SearchIcon} title={emptyMessage} />}</Show>
      <Show when={computed(() => entryList.value.length > 0 && visible.value.length === 0)}>{() => (
        <EmptyState inline icon={SearchIcon} title={computed(() => `No matches for “${search.value.trim()}”`)} />
      )}</Show>
      <Rebuild value={memo(() => [visible.value, current.value] as const)}>{([rows, currentRow]) => rows.length > 0 ? (
        <ul class="cms-mapping-picker__list">
          {rows.map((entry) => {
            const Icon = entry.icon;
            const selected = entry.key === currentRow;
            return (
              <li key={entry.key}>
                {Icon ? <Icon size="sm" class="cms-mapping-picker__glyph" /> : null}
                <span class="cms-mapping-picker__entry">
                  <strong>{entry.name}</strong>
                  <span>{entry.detail}</span>
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={selected}
                  aria-label={`${selected ? "Selected" : "Select"} ${entry.name}`}
                  on:click={() => {
                    onSelect(entry.key);
                    onClose();
                  }}
                >
                  {selected ? "Selected" : "Select"}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}</Rebuild>
    </Dialog>
  );
}
