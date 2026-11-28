import { computed, getScope, Show, signal, type Child } from "@takazudo/zfb/zudo-react";
import { formatIntent } from "../../../../app/route-intents";
import { toSignal, type MaybeSignal } from "../../../../components/reactive";
import { Rebuild } from "../../../../components/rebuild";
import { keyedBy } from "../../../mapping/signals";
import { ComposerIcon, EditIcon, ExternalLinkIcon } from "../../../../components/icons";
import { Banner, Button, EmptyState } from "../../../../components/ui";
import type { CompositionCatalog, ResolveOutcome } from "../../../../sitemapper/catalog";
import type { CompositionRef } from "../../../../sitemapper/model";
import { CompositionPickerDialog } from "../picker/composition-picker-dialog";

export interface CompositionFieldProps {
  value?: MaybeSignal<CompositionRef | undefined>;
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

export function CompositionField({ value: valueInput, catalog, onChange }: CompositionFieldProps): Child {
  const value = toSignal(valueInput);
  const pickerOpen = signal(false);
  let request = 0;
  const reference = signal<ReferenceState>(
    value.value ? { status: "loading", ref: value.value } : { status: "unassigned" },
  );
  // Only a different reference reloads; an unchanged one arriving as a new object does not.
  const stableRef = keyedBy(() => value.value, (ref) => ref ? `${ref.providerId}\u0000${ref.recordId}` : "");

  // `computed` has no equality cutoff: the effect re-runs on upstream changes, so it compares the last reference it loaded.
  let loadedRef: CompositionRef | null | undefined | false = false;
  getScope().effect(() => {
    const ref = stableRef.value;
    if (ref === loadedRef) return;
    loadedRef = ref;
    const current = ++request;
    if (!ref) {
      reference.value = { status: "unassigned" };
      return;
    }
    reference.value = { status: "loading", ref };
    // Catalog labels enrich a resolved reference, but an unexpected list
    // failure must not turn a successfully resolved target into a broken one.
    void Promise.all([
      catalog.resolveComposition(ref),
      catalog.listCompositions().catch(() => ({ entries: [], failures: [] })),
    ])
      .then(([outcome, list]) => {
        if (current !== request) return;
        if (outcome.status === "resolved") {
          const entry = list.entries.find((candidate) => sameRef(candidate.ref, ref));
          reference.value = {
            status: "resolved",
            ref,
            name: outcome.record.document.name,
            providerLabel: entry?.providerLabel ?? ref.providerId,
          };
          return;
        }
        reference.value = { status: "broken", ref, reason: brokenReason(outcome) };
      })
      .catch((reason: unknown) => {
        if (current !== request) return;
        reference.value = {
          status: "broken",
          ref,
          reason: reason instanceof Error ? reason.message : "The composition reference could not be resolved.",
        };
      });
  });

  const status = computed(() => reference.value.status);

  return (
    <div class="sg-sitemapper-source" role="group" aria-label="Composition">
      <Show when={computed(() => status.value === "unassigned")}>{() => (
        <EmptyState
          inline
          icon={ComposerIcon}
          title="No composition assigned"
          action={<Button variant="primary" size="sm" on:click={() => { pickerOpen.value = true; }}>Choose composition…</Button>}
        />
      )}</Show>

      <Show when={computed(() => status.value === "loading")}>{() => <p role="status">Resolving composition…</p>}</Show>

      <Rebuild value={reference}>{(current) => current.status === "resolved" ? (
        <div class="sg-sitemapper-source__card">
          <ComposerIcon size="sm" class="sg-sitemapper-source__glyph" />
          <span class="sg-sitemapper-source__text">
            <strong>{current.name}</strong>
            <span>{current.providerLabel}</span>
          </span>
          <Button size="xs" variant="ghost" iconOnly aria-label="Change composition" on:click={() => { pickerOpen.value = true; }}>
            <EditIcon size="xs" />
          </Button>
          {/* Source ownership is distinct from route-backed page authoring. */}
          <a
            class="cms-btn cms-btn--ghost cms-btn--xs cms-btn--icon"
            href={formatIntent({ route: "composer", providerId: current.ref.providerId, compositionId: current.ref.recordId })}
            aria-label="Open in Composer"
          >
            <ExternalLinkIcon size="xs" />
          </a>
        </div>
      ) : current.status === "broken" ? (
        <Banner
          tone="err"
          title="Broken reference"
          action={
            <>
              <Button size="sm" on:click={() => { pickerOpen.value = true; }}>Change…</Button>
              <Button size="sm" variant="danger" on:click={() => onChange(null)}>Clear</Button>
            </>
          }
        >
          {current.reason} <code class="sg-sitemapper-mono">{`${current.ref.providerId}:${current.ref.recordId}`}</code>
        </Banner>
      ) : null}</Rebuild>

      <CompositionPickerDialog
        open={pickerOpen}
        currentRef={value}
        listCompositions={() => catalog.listCompositions()}
        onSelect={onChange}
        onClose={() => { pickerOpen.value = false; }}
      />
    </div>
  );
}

export default CompositionField;
