/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { ComposerIcon, SearchIcon } from "../../../../components/icons";
import { Dialog } from "../../../../components/overlay";
import { Banner, Button, EmptyState, Input } from "../../../../components/ui";
import { matchesLibrarySearch } from "../../../../components/library-page";
import type { CatalogEntry, CompositionCatalogListOutcome } from "../../../../sitemapper/catalog";
import type { CompositionRef } from "../../../../sitemapper/model";

// The Composition chooser, on the shared modal. It keeps its own catalog
// request so a provider failure is reported per provider rather than sinking
// the whole list, and it never blocks on one that fails.

export interface CompositionPickerDialogProps {
  open: boolean;
  currentRef?: CompositionRef;
  listCompositions: () => Promise<CompositionCatalogListOutcome>;
  onSelect: (ref: CompositionRef) => void;
  onClose: () => void;
}

type PickerState =
  | { status: "loading"; outcome: CompositionCatalogListOutcome }
  | { status: "ready"; outcome: CompositionCatalogListOutcome }
  | { status: "error"; outcome: CompositionCatalogListOutcome; reason: string };

const EMPTY_OUTCOME: CompositionCatalogListOutcome = { entries: [], failures: [] };

function isCurrent(entry: CatalogEntry, currentRef?: CompositionRef): boolean {
  return currentRef?.providerId === entry.ref.providerId && currentRef.recordId === entry.ref.recordId;
}

export function CompositionPickerDialog({
  open,
  currentRef,
  listCompositions,
  onSelect,
  onClose,
}: CompositionPickerDialogProps): JSX.Element {
  const requestRef = useRef(0);
  const [state, setState] = useState<PickerState>({ status: "loading", outcome: EMPTY_OUTCOME });
  const [search, setSearch] = useState("");

  async function load(): Promise<void> {
    const request = ++requestRef.current;
    setState((current) => ({ status: "loading", outcome: current.outcome }));
    try {
      const outcome = await listCompositions();
      if (request === requestRef.current) setState({ status: "ready", outcome });
    } catch (reason) {
      if (request !== requestRef.current) return;
      setState({
        status: "error",
        outcome: EMPTY_OUTCOME,
        reason: reason instanceof Error ? reason.message : "The composition catalog could not be loaded.",
      });
    }
  }

  useEffect(() => {
    if (!open) {
      requestRef.current += 1;
      return;
    }
    setSearch("");
    void load();
    // Opening starts a fresh catalog request. Callback identity changes while
    // open must not continuously reload a controlled dialog.
  }, [open]);

  const { entries, failures } = state.outcome;
  const visible = entries.filter((entry) => matchesLibrarySearch(`${entry.name} ${entry.providerLabel}`, search));

  return (
    <Dialog
      open={open}
      title="Choose a composition"
      class="sg-sitemapper-picker"
      onClose={onClose}
      footer={<button type="button" class="cms-dialog__action" onClick={onClose}>Cancel</button>}
    >
      <Input
        type="search"
        icon={SearchIcon}
        value={search}
        aria-label="Filter compositions"
        placeholder={`Search ${entries.length} ${entries.length === 1 ? "composition" : "compositions"}…`}
        onInput={(event) => setSearch(event.currentTarget.value)}
      />
      {failures.map((failure) => (
        <Banner key={failure.providerId} tone="warn" title={`${failure.providerLabel} could not be loaded.`}>
          {failure.reason}
        </Banner>
      ))}
      {state.status === "error" ? (
        <Banner tone="err" title="The composition catalog could not be loaded." action={<Button size="sm" onClick={() => void load()}>Retry</Button>}>
          {state.reason}
        </Banner>
      ) : null}
      {state.status === "loading" && entries.length === 0 ? <p role="status">Loading compositions…</p> : null}
      {state.status === "ready" && entries.length === 0 && failures.length === 0 ? (
        <EmptyState inline icon={ComposerIcon} title="No saved compositions are available." />
      ) : null}
      {entries.length > 0 && visible.length === 0 ? (
        <EmptyState inline icon={SearchIcon} title={`No matches for “${search.trim()}”`} />
      ) : null}
      {visible.length > 0 ? (
        <ul class="sg-sitemapper-picker__list" aria-label="Saved compositions">
          {visible.map((entry) => {
            const current = isCurrent(entry, currentRef);
            const action = current ? "Assigned" : currentRef ? "Replace" : "Assign";
            return (
              <li key={`${entry.ref.providerId}:${entry.ref.recordId}`}>
                <ComposerIcon size="sm" class="sg-sitemapper-picker__glyph" />
                <span class="sg-sitemapper-picker__entry">
                  <strong>{entry.name}</strong>
                  <span>{entry.nodeCount} {entry.nodeCount === 1 ? "node" : "nodes"} · {entry.providerLabel}</span>
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={current}
                  aria-label={`${action} ${entry.name} from ${entry.providerLabel}`}
                  onClick={() => {
                    onSelect(entry.ref);
                    onClose();
                  }}
                >
                  {action}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Dialog>
  );
}

export default CompositionPickerDialog;
