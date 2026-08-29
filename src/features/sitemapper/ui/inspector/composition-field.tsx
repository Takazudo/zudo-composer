/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type {
  CompositionCatalog,
  ResolveOutcome,
} from "../../../../sitemapper/catalog";
import type { CompositionRef } from "../../../../sitemapper/model";
import { CompositionPickerDialog } from "../picker/composition-picker-dialog";

export interface CompositionFieldProps {
  value?: CompositionRef;
  catalog: Pick<CompositionCatalog, "listCompositions" | "resolveComposition">;
  onChange: (value: CompositionRef | null) => void;
}

type ReferenceState =
  | { status: "unassigned" }
  | { status: "loading"; ref: CompositionRef }
  | { status: "resolved"; ref: CompositionRef; name: string; providerLabel: string }
  | { status: "broken"; ref: CompositionRef; reason: string };

function sameRef(a: CompositionRef, b: CompositionRef): boolean {
  return a.providerId === b.providerId && a.recordId === b.recordId;
}

function brokenReason(outcome: Exclude<ResolveOutcome, { status: "resolved" }>): string {
  switch (outcome.status) {
    case "not-found": return "The saved composition was deleted or is no longer available.";
    case "provider-unavailable": return "This composition provider is unavailable in this build.";
    case "unreadable-target": return `The saved composition cannot be read: ${outcome.reason}`;
    case "invalid-ref": return `The saved reference is invalid: ${outcome.reason}`;
  }
}

export function CompositionField({ value, catalog, onChange }: CompositionFieldProps): JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false);
  const requestRef = useRef(0);
  const [reference, setReference] = useState<ReferenceState>(
    value ? { status: "loading", ref: value } : { status: "unassigned" },
  );

  useEffect(() => {
    const request = ++requestRef.current;
    if (!value) {
      setReference({ status: "unassigned" });
      return;
    }
    const ref = value;
    setReference({ status: "loading", ref });
    // Catalog labels enrich a resolved reference, but an unexpected list
    // failure must not turn a successfully resolved target into a broken one.
    void Promise.all([
      catalog.resolveComposition(ref),
      catalog.listCompositions().catch(() => ({ entries: [], failures: [] })),
    ])
      .then(([outcome, list]) => {
        if (request !== requestRef.current) return;
        if (outcome.status === "resolved") {
          const entry = list.entries.find((candidate) => sameRef(candidate.ref, ref));
          setReference({
            status: "resolved",
            ref,
            name: outcome.record.document.name,
            providerLabel: entry?.providerLabel ?? ref.providerId,
          });
          return;
        }
        setReference({ status: "broken", ref, reason: brokenReason(outcome) });
      })
      .catch((reason) => {
        if (request !== requestRef.current) return;
        setReference({
          status: "broken",
          ref,
          reason: reason instanceof Error ? reason.message : "The composition reference could not be resolved.",
        });
      });
  }, [catalog, value?.providerId, value?.recordId]);

  return (
    <section class="sg-sitemapper-composition" aria-labelledby="sg-sitemapper-composition-label">
      <h3 id="sg-sitemapper-composition-label">Composition</h3>

      {reference.status === "unassigned" && (
        <div class="sg-sitemapper-composition__state">
          <p>No composition assigned.</p>
          <button type="button" onClick={() => setPickerOpen(true)}>Choose composition</button>
        </div>
      )}

      {reference.status === "loading" && <p role="status">Resolving composition…</p>}

      {reference.status === "resolved" && (
        <div class="sg-sitemapper-composition__state">
          <p><strong>{reference.name}</strong><span>{reference.providerLabel}</span></p>
          <div class="sg-sitemapper-composition__actions">
            <button type="button" onClick={() => setPickerOpen(true)}>Replace composition</button>
            <button type="button" class="sg-sitemapper-danger" onClick={() => onChange(null)}>Clear composition</button>
          </div>
        </div>
      )}

      {reference.status === "broken" && (
        <div class="sg-sitemapper-composition__state sg-sitemapper-composition__state--broken">
          <p><strong class="sg-sitemapper-composition__badge">Broken reference</strong></p>
          <p>{reference.reason}</p>
          <dl>
            <div>
              <dt>Raw reference</dt>
              <dd><code>{reference.ref.providerId}:{reference.ref.recordId}</code></dd>
            </div>
          </dl>
          <div class="sg-sitemapper-composition__actions">
            <button type="button" onClick={() => setPickerOpen(true)}>Replace composition</button>
            <button type="button" class="sg-sitemapper-danger" onClick={() => onChange(null)}>Clear composition</button>
          </div>
        </div>
      )}

      <CompositionPickerDialog
        open={pickerOpen}
        currentRef={value}
        listCompositions={() => catalog.listCompositions()}
        onSelect={onChange}
        onClose={() => setPickerOpen(false)}
      />
    </section>
  );
}

export default CompositionField;
