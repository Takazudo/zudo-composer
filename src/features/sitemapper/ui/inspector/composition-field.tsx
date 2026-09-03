/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { ComposerIcon, EditIcon, ExternalLinkIcon } from "../../../../components/icons";
import { Banner, Button, EmptyState } from "../../../../components/ui";
import type { CompositionCatalog, ResolveOutcome } from "../../../../sitemapper/catalog";
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
      .catch((reason: unknown) => {
        if (request !== requestRef.current) return;
        setReference({
          status: "broken",
          ref,
          reason: reason instanceof Error ? reason.message : "The composition reference could not be resolved.",
        });
      });
  }, [catalog, value?.providerId, value?.recordId]);

  return (
    <div class="sg-sitemapper-source" role="group" aria-label="Composition">
      {reference.status === "unassigned" ? (
        <EmptyState
          inline
          icon={ComposerIcon}
          title="No composition assigned"
          action={<Button variant="primary" size="sm" onClick={() => setPickerOpen(true)}>Choose composition…</Button>}
        />
      ) : null}

      {reference.status === "loading" ? <p role="status">Resolving composition…</p> : null}

      {reference.status === "resolved" ? (
        <div class="sg-sitemapper-source__card">
          <ComposerIcon size="sm" class="sg-sitemapper-source__glyph" />
          <span class="sg-sitemapper-source__text">
            <strong>{reference.name}</strong>
            <span>{reference.providerLabel}</span>
          </span>
          <Button size="xs" variant="ghost" iconOnly aria-label="Change composition" onClick={() => setPickerOpen(true)}>
            <EditIcon size="xs" />
          </Button>
          {/* `route-intents` has no Composer record intent yet, so this opens
              the workspace rather than pretending to open the record. */}
          <a
            class="cms-btn cms-btn--ghost cms-btn--xs cms-btn--icon"
            href="/composer"
            aria-label="Open in Composer"
          >
            <ExternalLinkIcon size="xs" />
          </a>
        </div>
      ) : null}

      {reference.status === "broken" ? (
        <Banner
          tone="err"
          title="Broken reference"
          action={
            <>
              <Button size="sm" onClick={() => setPickerOpen(true)}>Change…</Button>
              <Button size="sm" variant="danger" onClick={() => onChange(null)}>Clear</Button>
            </>
          }
        >
          {reference.reason} <code class="sg-sitemapper-mono">{reference.ref.providerId}:{reference.ref.recordId}</code>
        </Banner>
      ) : null}

      <CompositionPickerDialog
        open={pickerOpen}
        currentRef={value}
        listCompositions={() => catalog.listCompositions()}
        onSelect={onChange}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}

export default CompositionField;
