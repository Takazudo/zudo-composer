/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { MappingIcon } from "../../../../components/icons";
import { Dialog } from "../../../../components/overlay";
import { Banner, Button, EmptyState } from "../../../../components/ui";
import type { MappingRef } from "../../../../sitemapper/model";
import type { MappingAssignmentCatalog } from "../../../../sitemapper/routes";

type MappingListOutcome = Awaited<ReturnType<MappingAssignmentCatalog["list"]>>;

export interface MappingPickerDialogProps {
  open: boolean;
  catalog: MappingAssignmentCatalog;
  onSelect: (ref: MappingRef) => void;
  onClose: () => void;
}

export function MappingPickerDialog({ open, catalog, onSelect, onClose }: MappingPickerDialogProps): JSX.Element {
  const [state, setState] = useState<{ loading: boolean; outcome: MappingListOutcome; error?: string }>({
    loading: false,
    outcome: { entries: [], failures: [] },
  });

  useEffect(() => {
    if (!open) return;
    setState((current) => ({ ...current, loading: true, error: undefined }));
    void catalog.list().then(
      (outcome) => setState({ loading: false, outcome }),
      (error: unknown) => setState({
        loading: false,
        outcome: { entries: [], failures: [] },
        error: error instanceof Error ? error.message : "The Mapping catalog could not be loaded.",
      }),
    );
  }, [open, catalog]);

  const { entries, failures } = state.outcome;

  return (
    <Dialog
      open={open}
      title="Choose a Content Mapping"
      class="sg-sitemapper-picker"
      onClose={onClose}
      footer={<button type="button" class="cms-dialog__action" onClick={onClose}>Cancel</button>}
    >
      <p class="cms-dialog__message">Assign one Mapping route family to this authored page.</p>
      {state.error ? <Banner tone="err">{state.error}</Banner> : null}
      {failures.map((failure) => (
        <Banner key={failure.providerId} tone="warn" title={`${failure.providerLabel} could not be loaded.`}>
          {failure.reason}
        </Banner>
      ))}
      {state.loading && entries.length === 0 ? <p role="status">Loading Mappings…</p> : null}
      {!state.loading && !state.error && entries.length === 0 ? (
        <EmptyState inline icon={MappingIcon} title="No saved Mappings are available." />
      ) : null}
      {entries.length > 0 ? (
        <ul class="sg-sitemapper-picker__list" aria-label="Saved Content Mappings">
          {entries.map((entry) => (
            <li key={`${entry.ref.providerId}:${entry.ref.recordId}`}>
              <MappingIcon size="sm" class="sg-sitemapper-picker__glyph" />
              <span class="sg-sitemapper-picker__entry">
                <strong>{entry.summary.name}</strong>
                <span>{entry.summary.bindingCount} bindings · {entry.providerLabel}</span>
              </span>
              <Button
                variant="primary"
                size="sm"
                aria-label={`Assign ${entry.summary.name} from ${entry.providerLabel}`}
                onClick={() => {
                  onSelect(entry.ref);
                  onClose();
                }}
              >
                Assign
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </Dialog>
  );
}

export default MappingPickerDialog;
