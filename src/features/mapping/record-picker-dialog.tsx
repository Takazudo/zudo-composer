/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { SearchIcon, type IconComponent } from "../../components/icons";
import { matchesLibrarySearch } from "../../components/library-page";
import { Dialog } from "../../components/overlay";
import { Button, EmptyState, Input } from "../../components/ui";

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
  open: boolean;
  title: string;
  /** One line saying what picking here changes. */
  description: string;
  searchLabel: string;
  entries: readonly RecordPickerEntry[];
  /** The record in force; its row is marked and inert. */
  currentKey: string;
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
}: RecordPickerDialogProps): JSX.Element {
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState("");

  // During the opening render rather than in an effect; see `NewMappingDialog`.
  const wasOpen = useRef(open);
  if (open !== wasOpen.current) {
    wasOpen.current = open;
    if (open) setSearch("");
  }

  const visible = entries.filter((entry) => matchesLibrarySearch(`${entry.name} ${entry.detail}`, search));
  const query = search.trim();

  return (
    <Dialog
      open={open}
      title={title}
      class="cms-mapping-picker"
      initialFocusRef={searchRef}
      onClose={onClose}
      footer={
        <button type="button" class="cms-dialog__action" onClick={onClose}>
          Cancel
        </button>
      }
    >
      <p class="cms-dialog__message">{description}</p>
      <Input
        elementRef={searchRef}
        type="search"
        icon={SearchIcon}
        value={search}
        aria-label={searchLabel}
        placeholder={`Search ${entries.length} ${entries.length === 1 ? "record" : "records"}…`}
        onInput={(event) => setSearch(event.currentTarget.value)}
      />
      {entries.length === 0 ? <EmptyState inline icon={SearchIcon} title={emptyMessage} /> : null}
      {entries.length > 0 && visible.length === 0 ? (
        <EmptyState inline icon={SearchIcon} title={`No matches for “${query}”`} />
      ) : null}
      {visible.length > 0 ? (
        <ul class="cms-mapping-picker__list" aria-label={title}>
          {visible.map((entry) => {
            const Icon = entry.icon;
            const current = entry.key === currentKey;
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
                  disabled={current}
                  aria-label={`${current ? "Selected" : "Select"} ${entry.name}`}
                  onClick={() => {
                    onSelect(entry.key);
                    onClose();
                  }}
                >
                  {current ? "Selected" : "Select"}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Dialog>
  );
}
