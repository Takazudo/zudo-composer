import { computed, For, getScope, Show, signal, type Child } from "@takazudo/zfb/zudo-react";
import { ComposerIcon, SearchIcon } from "../../../../components/icons";
import { Dialog } from "../../../../components/overlay";
import { derive, memo, toSignal, type MaybeSignal } from "../../../../components/reactive";
import { Rebuild } from "../../../../components/rebuild";
import { Banner, Button, EmptyState, Input } from "../../../../components/ui";
import { matchesLibrarySearch } from "../../../../components/library-page";
import type { CatalogEntry, CompositionCatalogListOutcome } from "../../../../sitemapper/catalog";
import type { CompositionRef } from "../../../../sitemapper/model";

// The Composition chooser, on the shared modal. It keeps its own catalog
// request so a provider failure is reported per provider rather than sinking
// the whole list, and it never blocks on one that fails.

export interface CompositionPickerDialogProps {
  open: MaybeSignal<boolean>;
  currentRef?: MaybeSignal<CompositionRef | undefined>;
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
  open: openInput,
  currentRef: currentInput,
  listCompositions,
  onSelect,
  onClose,
}: CompositionPickerDialogProps): Child {
  const open = toSignal(openInput);
  const currentRef = toSignal(currentInput);
  let request = 0;
  const state = signal<PickerState>({ status: "loading", outcome: EMPTY_OUTCOME });
  const search = signal("");

  // A plain mirror of the last outcome: `load` runs inside the open effect and must not track `state`.
  let lastOutcome = EMPTY_OUTCOME;
  const setState = (next: PickerState) => { lastOutcome = next.outcome; state.value = next; };

  async function load(): Promise<void> {
    const current = ++request;
    setState({ status: "loading", outcome: lastOutcome });
    try {
      const outcome = await listCompositions();
      if (current === request) setState({ status: "ready", outcome });
    } catch (reason) {
      if (current !== request) return;
      setState({
        status: "error",
        outcome: EMPTY_OUTCOME,
        reason: reason instanceof Error ? reason.message : "The composition catalog could not be loaded.",
      });
    }
  }

  // Opening starts a fresh catalog request; closing abandons the one in flight.
  // `computed` has no equality cutoff, so only an open/close transition acts.
  let wasOpen = false;
  getScope().effect(() => {
    const isOpen = open.value;
    if (isOpen === wasOpen) return;
    wasOpen = isOpen;
    if (!isOpen) {
      request += 1;
      return;
    }
    search.value = "";
    void load();
  });

  const entries = computed(() => state.value.outcome.entries);
  const failures = computed(() => state.value.outcome.failures);
  const visible = derive(() => [entries.value, search.value] as const, (list, text) => list.filter((entry) => matchesLibrarySearch(`${entry.name} ${entry.providerLabel}`, text)));

  return (
    <Dialog
      open={open}
      title="Choose a composition"
      class="sg-sitemapper-picker"
      onClose={onClose}
      footer={<button type="button" class="cms-dialog__action" on:click={() => onClose()}>Cancel</button>}
    >
      <Input
        type="search"
        icon={SearchIcon}
        modelValue={search}
        aria-label="Filter compositions"
        placeholder={computed(() => `Search ${entries.value.length} ${entries.value.length === 1 ? "composition" : "compositions"}…`)}
      />
      <For each={failures} by={(failure) => failure.providerId}>{(failure) => (
        <Banner tone="warn" title={computed(() => `${failure.value.providerLabel} could not be loaded.`)}>
          {computed(() => failure.value.reason)}
        </Banner>
      )}</For>
      <Show when={computed(() => state.value.status === "error")}>{() => (
        <Banner tone="err" title="The composition catalog could not be loaded." action={<Button size="sm" on:click={() => void load()}>Retry</Button>}>
          {computed(() => { const current = state.value; return current.status === "error" ? current.reason : ""; })}
        </Banner>
      )}</Show>
      <Show when={computed(() => state.value.status === "loading" && entries.value.length === 0)}>{() => <p role="status">Loading compositions…</p>}</Show>
      <Show when={computed(() => state.value.status === "ready" && entries.value.length === 0 && failures.value.length === 0)}>{() => (
        <EmptyState inline icon={ComposerIcon} title="No saved compositions are available." />
      )}</Show>
      <Show when={computed(() => entries.value.length > 0 && visible.value.length === 0)}>{() => (
        <EmptyState inline icon={SearchIcon} title={computed(() => `No matches for “${search.value.trim()}”`)} />
      )}</Show>
      <Rebuild value={memo(() => [visible.value, currentRef.value] as const)}>{([rows, assigned]) => rows.length > 0 ? (
        <ul class="sg-sitemapper-picker__list" aria-label="Saved compositions">
          {rows.map((entry) => {
            const current = isCurrent(entry, assigned);
            const action = current ? "Assigned" : assigned ? "Replace" : "Assign";
            return (
              <li key={`${entry.ref.providerId}:${entry.ref.recordId}`}>
                <ComposerIcon size="sm" class="sg-sitemapper-picker__glyph" />
                <span class="sg-sitemapper-picker__entry">
                  <strong>{entry.name}</strong>
                  <span>{`${entry.nodeCount} ${entry.nodeCount === 1 ? "node" : "nodes"} · ${entry.providerLabel}`}</span>
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={current}
                  aria-label={`${action} ${entry.name} from ${entry.providerLabel}`}
                  on:click={() => {
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
      ) : null}</Rebuild>
    </Dialog>
  );
}

export default CompositionPickerDialog;
