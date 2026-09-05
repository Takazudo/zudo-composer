/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useMemo, useRef, useState } from "preact/hooks";
import { ChevronDownIcon, ChevronUpIcon, SearchIcon, XMarkIcon } from "../../components/icons";
import { Dialog } from "../../components/overlay";
import { Button, Checkbox, EmptyState, Input } from "../../components/ui";
import type { ContentEntryRecord, ContentModelRecord } from "../../content";
import type { MappingCollectionPin } from "../../mapping";
import type { MappingCollectionQuery } from "../../mapping";
import { entryLabel } from "./presentation";

export interface PinPickerDialogProps {
  open: boolean;
  entries: readonly ContentEntryRecord[];
  model: ContentModelRecord | null;
  providerId: string;
  currentPins: readonly MappingCollectionPin[];
  publication: MappingCollectionQuery["publication"];
  onSave: (pins: readonly MappingCollectionPin[]) => void;
  onClose: () => void;
}

export function PinPickerDialog({ open, entries, model, providerId, currentPins, publication, onSave, onClose }: PinPickerDialogProps): JSX.Element {
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState("");
  const [pins, setPins] = useState<MappingCollectionPin[]>(() => [...currentPins]);
  const wasOpen = useRef(open);
  if (open !== wasOpen.current) {
    wasOpen.current = open;
    if (open) {
      setSearch("");
      setPins([...currentPins]);
    }
  }

  const catalog = useMemo(() => {
    const pinned = new Set(pins.map((pin) => pin.recordId));
    const modelEntries = entries.filter((entry) => entry.modelId === model?.id);
    return [...modelEntries.filter((entry) => pinned.has(entry.id)), ...modelEntries.filter((entry) => !pinned.has(entry.id)).sort((left, right) => left.id.localeCompare(right.id))];
  }, [entries, model?.id, pins]);
  const visible = catalog.filter((entry) => `${entry.id} ${entryLabel(entry, model)}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const stale = pins.filter((pin) => pin.providerId !== providerId || pin.modelId !== model?.id || !entries.some((entry) => entry.id === pin.recordId && entry.modelId === model?.id && (publication === "include-drafts" || entry.lifecycle !== "draft")));

  function toggle(entry: ContentEntryRecord, checked: boolean): void {
    if (checked) {
      if (pins.some((pin) => pin.recordId === entry.id)) return;
      setPins([...pins, { providerId, modelId: entry.modelId, recordId: entry.id }]);
    } else {
      setPins(pins.filter((pin) => pin.recordId !== entry.id));
    }
  }

  function move(index: number, direction: -1 | 1): void {
    const next = index + direction;
    if (next < 0 || next >= pins.length) return;
    const reordered = [...pins];
    [reordered[index], reordered[next]] = [reordered[next]!, reordered[index]!];
    setPins(reordered);
  }

  return (
    <Dialog
      open={open}
      title="Choose ordered pins"
      class="cms-mapping-pin-picker"
      initialFocusRef={searchRef}
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => { onSave(pins); onClose(); }}>Save pins</Button></>}
    >
      <p class="cms-dialog__message">Pins come from the complete current source catalog. Stale or ineligible pins remain visible in Diagnostics.</p>
      <Input elementRef={searchRef} type="search" icon={SearchIcon} aria-label="Filter source Entries" placeholder={`Search ${catalog.length} Entries…`} value={search} onInput={(event) => setSearch(event.currentTarget.value)} />
      {model === null ? <EmptyState inline icon={SearchIcon} title="Resolve a collection Content model first." /> : null}
      {model && catalog.length === 0 ? <EmptyState inline icon={SearchIcon} title="No eligible Entries in the source catalog." /> : null}
      {stale.length ? <section class="cms-mapping-pin-picker__stale"><strong>Stale pins</strong>{stale.map((pin) => <div key={`${pin.providerId}/${pin.modelId}/${pin.recordId}`}><span>{pin.recordId}</span><Button iconOnly variant="ghost" size="sm" aria-label={`Remove stale pin ${pin.recordId}`} onClick={() => setPins(pins.filter((candidate) => candidate.recordId !== pin.recordId))}><XMarkIcon size="sm" /></Button></div>)}</section> : null}
      {visible.length ? <ul class="cms-mapping-pin-picker__catalog">{visible.map((entry) => <li key={entry.id}><Checkbox disabled={publication === "published-only" && entry.lifecycle === "draft"} label={<><strong>{entryLabel(entry, model)}</strong><code>{entry.id}{entry.lifecycle === "draft" ? " · draft" : ""}</code></>} checked={pins.some((pin) => pin.recordId === entry.id)} onCheckedChange={(checked) => toggle(entry, checked)} /></li>)}</ul> : null}
      {pins.length ? <section class="cms-mapping-pin-picker__order"><h3>Pin order</h3><ol>{pins.map((pin, index) => { const entry = entries.find((candidate) => candidate.id === pin.recordId); return <li key={`${pin.providerId}/${pin.modelId}/${pin.recordId}`}><span>{entry ? entryLabel(entry, model) : pin.recordId}</span><span class="cms-mapping-pin-picker__order-actions"><Button iconOnly variant="ghost" size="sm" disabled={index === 0} aria-label={`Move pin ${pin.recordId} up`} onClick={() => move(index, -1)}><ChevronUpIcon size="sm" /></Button><Button iconOnly variant="ghost" size="sm" disabled={index === pins.length - 1} aria-label={`Move pin ${pin.recordId} down`} onClick={() => move(index, 1)}><ChevronDownIcon size="sm" /></Button></span></li>; })}</ol></section> : null}
    </Dialog>
  );
}
