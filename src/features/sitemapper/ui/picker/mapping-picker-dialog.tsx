import { computed, For, getScope, Show, signal, type Child } from "@takazudo/zfb/zudo-react";
import { MappingIcon } from "../../../../components/icons";
import { Dialog } from "../../../../components/overlay";
import { toSignal, type MaybeSignal } from "../../../../components/reactive";
import { Rebuild } from "../../../../components/rebuild";
import { Banner, Button, EmptyState } from "../../../../components/ui";
import type { MappingRef } from "../../../../sitemapper/model";
import type { MappingAssignmentCatalog } from "../../../../sitemapper/routes";

type MappingListOutcome = Awaited<ReturnType<MappingAssignmentCatalog["list"]>>;

export interface MappingPickerDialogProps {
  open: MaybeSignal<boolean>;
  catalog: MappingAssignmentCatalog;
  onSelect: (ref: MappingRef) => void;
  onClose: () => void;
}

export function MappingPickerDialog({ open: openInput, catalog, onSelect, onClose }: MappingPickerDialogProps): Child {
  const open = toSignal(openInput);
  const state = signal<{ loading: boolean; outcome: MappingListOutcome; error?: string }>({
    loading: false,
    outcome: { entries: [], failures: [] },
  });

  // The effect reads only `open`; the previous outcome comes from a plain mirror.
  let lastOutcome: MappingListOutcome = state.value.outcome;
  // `computed` has no equality cutoff, so only the opening transition loads.
  let wasOpen = false;
  getScope().effect(() => {
    const isOpen = open.value;
    if (isOpen === wasOpen) return;
    wasOpen = isOpen;
    if (!isOpen) return;
    state.value = { outcome: lastOutcome, loading: true, error: undefined };
    void catalog.list().then(
      (outcome) => { lastOutcome = outcome; state.value = { loading: false, outcome }; },
      (error: unknown) => {
        lastOutcome = { entries: [], failures: [] };
        state.value = {
          loading: false,
          outcome: { entries: [], failures: [] },
          error: error instanceof Error ? error.message : "The Mapping catalog could not be loaded.",
        };
      },
    );
  });

  const entries = computed(() => state.value.outcome.entries);

  return (
    <Dialog
      open={open}
      title="Choose a Mapping"
      class="sg-sitemapper-picker"
      onClose={onClose}
      footer={<button type="button" class="cms-dialog__action" on:click={() => onClose()}>Cancel</button>}
    >
      <p class="cms-dialog__message">Assign one Mapping route family to this authored page.</p>
      <Show when={computed(() => Boolean(state.value.error))}>{() => <Banner tone="err">{computed(() => state.value.error ?? "")}</Banner>}</Show>
      <For each={computed(() => state.value.outcome.failures)} by={(failure) => failure.providerId}>{(failure) => (
        <Banner tone="warn" title={computed(() => `${failure.value.providerLabel} could not be loaded.`)}>
          {computed(() => failure.value.reason)}
        </Banner>
      )}</For>
      <Show when={computed(() => state.value.loading && entries.value.length === 0)}>{() => <p role="status">Loading Mappings…</p>}</Show>
      <Show when={computed(() => !state.value.loading && !state.value.error && entries.value.length === 0)}>{() => (
        <EmptyState inline icon={MappingIcon} title="No saved Mappings are available." />
      )}</Show>
      <Rebuild value={entries}>{(rows) => rows.length > 0 ? (
        <ul class="sg-sitemapper-picker__list" aria-label="Saved Mappings">
          {rows.map((entry) => (
            <li key={`${entry.ref.providerId}:${entry.ref.recordId}`}>
              <MappingIcon size="sm" class="sg-sitemapper-picker__glyph" />
              <span class="sg-sitemapper-picker__entry">
                <strong>{entry.summary.name}</strong>
                <span>{`${entry.summary.bindingCount} bindings · ${entry.providerLabel}`}</span>
              </span>
              <Button
                variant="primary"
                size="sm"
                aria-label={`Assign ${entry.summary.name} from ${entry.providerLabel}`}
                on:click={() => {
                  onSelect(entry.ref);
                  onClose();
                }}
              >
                Assign
              </Button>
            </li>
          ))}
        </ul>
      ) : null}</Rebuild>
    </Dialog>
  );
}

export default MappingPickerDialog;
