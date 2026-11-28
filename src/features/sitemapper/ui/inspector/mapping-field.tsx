import { computed, Show, signal, type Child } from "@takazudo/zfb/zudo-react";
import { followModel, keyedBy, memo, toSignal, type MaybeSignal } from "../../../../components/reactive";
import { Rebuild } from "../../../../components/rebuild";
import { Keyed } from "../../../../runtime";
import { EditIcon, MappingIcon } from "../../../../components/icons";
import { Banner, Button, Chip, EmptyState, Field, Select } from "../../../../components/ui";
import type { MappingRef, SitemapPageSource } from "../../../../sitemapper/model";
import type { MappingAssignmentCatalog, SitemapNodeRouteInfo } from "../../../../sitemapper/routes";
import { describeRouteStatus } from "../canvas/page-source";
import { MappingPickerDialog } from "../picker/mapping-picker-dialog";

type MappingSource = Extract<SitemapPageSource, { kind: "mapping" }>;

/** Everything the two resolvers can answer that is not something to assign. */
type ResolveFailure =
  | { status: "not-found" }
  | { status: "invalid"; reason: string }
  | { status: "provider-error"; reason: string };

/**
 * Why an assignment was abandoned, said in the field rather than swallowed.
 * Picking a Mapping the catalog can list but the resolver cannot read used to
 * close the dialog and change nothing at all.
 */
function describeAssignFailure(subject: string, outcome: ResolveFailure): string {
  return outcome.status === "not-found"
    ? `${subject} no longer exists, so nothing was assigned.`
    : `${subject} could not be read (${outcome.reason}), so nothing was assigned.`;
}

interface FieldChoice { id: string; label: string }

/**
 * The options a field select offers. A stored field the model no longer lists
 * stays selectable as a stale option, so the select never holds a value it
 * cannot show.
 */
function fieldChoices(fields: readonly FieldChoice[], stored: string, allowEmpty: boolean): FieldChoice[] {
  const listed = fields.map(({ id, label }) => ({ id, label }));
  const stale = stored !== "" && !listed.some((field) => field.id === stored) ? [{ id: stored, label: `Missing field (${stored}) · stale` }] : [];
  const empty = allowEmpty ? [{ id: "", label: "Use page title" }] : listed.length === 0 && stale.length === 0 ? [{ id: "", label: "No slug fields" }] : [];
  return [...empty, ...stale, ...listed];
}

function choicesKey(choices: readonly FieldChoice[]): string {
  return JSON.stringify(choices);
}

/** A model for one mounted option set: a value it does not list waits for the rebuild that adds it. */
function pickListed(choices: readonly FieldChoice[], stored: string): string {
  return choices.some((choice) => choice.id === stored) ? stored : choices[0]?.id ?? "";
}

function MappingCard({ detail: currentDetail, info, slugLabel, onChange }: { detail: NonNullable<SitemapNodeRouteInfo["mapping"]>; info: SitemapNodeRouteInfo; slugLabel: string | null; onChange: () => void }): Child {
  return (
    <div class="sg-sitemapper-source__card">
      <MappingIcon size="sm" class="sg-sitemapper-source__glyph" />
      <span class="sg-sitemapper-source__text">
        <strong>{currentDetail.name}</strong>
        <span>
          {`${slugLabel ? `slug field: ${slugLabel} · ` : ""}${info.derivedRouteCount} ${info.derivedRouteCount === 1 ? "route" : "routes"}`}
        </span>
      </span>
      <Chip tone={info.status === "ready" ? "ok" : "warn"} dot>{describeRouteStatus(info.status)}</Chip>
      <Button size="xs" variant="ghost" iconOnly aria-label="Change mapping" on:click={onChange}>
        <EditIcon size="xs" />
      </Button>
    </div>
  );
}

export interface MappingFieldProps {
  value?: MaybeSignal<MappingSource | undefined>;
  routeInfo?: MaybeSignal<SitemapNodeRouteInfo | undefined>;
  catalog: MappingAssignmentCatalog;
  onChange: (source: SitemapPageSource) => void;
}

export function MappingField({ value: valueInput, routeInfo: routeInfoInput, catalog, onChange }: MappingFieldProps): Child {
  const value = toSignal(valueInput);
  const routeInfo = toSignal(routeInfoInput);
  const pickerOpen = signal(false);
  const assignError = signal<string | null>(null);
  const detail = computed(() => routeInfo.value?.mapping);
  const openPicker = () => { assignError.value = null; pickerOpen.value = true; };

  const assign = async (ref: MappingRef): Promise<void> => {
    assignError.value = null;
    try {
      const mapping = await catalog.routes.resolveMapping(ref);
      if (mapping.status !== "resolved") {
        assignError.value = describeAssignFailure("That Mapping", mapping);
        return;
      }
      const content = await catalog.routes.resolveContentSnapshot(mapping.record);
      if (content.status !== "resolved") {
        assignError.value = describeAssignFailure("That Mapping's content model", content);
        return;
      }
      if (content.model.document.kind === "single") {
        onChange({ kind: "mapping", ref, route: { kind: "single" } });
        return;
      }
      // A collection derives one route per entry from a slug field. Without one
      // there is no route family to author, and a placeholder field id would
      // only persist an assignment that can never resolve.
      const slugField = content.model.document.fields.find((field) => field.kind === "slug");
      if (!slugField) {
        assignError.value = `“${content.model.document.name}” has no slug field, so it derives no routes.`;
        return;
      }
      onChange({ kind: "mapping", ref, route: { kind: "entry-field", fieldId: slugField.id } });
    } catch (reason) {
      assignError.value = reason instanceof Error ? reason.message : "That Mapping could not be assigned.";
    }
  };

  const slugFieldLabel = computed(() => {
    const current = value.value;
    const routeFieldId = current !== undefined && current.route.kind === "entry-field" ? current.route.fieldId : null;
    return routeFieldId === null ? null : detail.value?.slugFields.find((field) => field.id === routeFieldId)?.label ?? routeFieldId;
  });
  const hasValue = computed(() => value.value !== undefined);
  const resolved = computed(() => routeInfo.value !== undefined && detail.value !== undefined);
  const card = memo(() => {
    const currentDetail = detail.value;
    const info = routeInfo.value;
    return currentDetail && info ? [currentDetail, info, slugFieldLabel.value] as const : null;
  });
  const storedSlugId = computed(() => { const current = value.value; return current?.route.kind === "entry-field" ? current.route.fieldId : ""; });
  const storedTitleId = computed(() => { const current = value.value; return current?.route.kind === "entry-field" ? current.route.titleFieldId ?? "" : ""; });
  const slugChoices = keyedBy(() => fieldChoices(detail.value?.slugFields ?? [], storedSlugId.value, false), choicesKey);
  const titleChoices = keyedBy(() => fieldChoices(detail.value?.titleFields ?? [], storedTitleId.value, true), choicesKey);

  return (
    <div class="sg-sitemapper-source" role="group" aria-label="Mapping">
      <Show when={computed(() => assignError.value !== null)}>{() => <Banner tone="err">{computed(() => assignError.value ?? "")}</Banner>}</Show>
      <Show when={computed(() => !hasValue.value)}>{() => (
        <EmptyState
          inline
          icon={MappingIcon}
          title="No mapping assigned"
          action={<Button variant="primary" size="sm" on:click={openPicker}>Choose mapping…</Button>}
        />
      )}</Show>
      <Show when={hasValue}>{() => (
        <>
          <Show when={computed(() => routeInfo.value === undefined)}>{() => <p role="status">Resolving mapping…</p>}</Show>
          <Show when={computed(() => routeInfo.value !== undefined && detail.value === undefined)}>{() => (
            <Banner
              tone="err"
              title="Broken reference"
              action={<Button size="sm" on:click={openPicker}>Change…</Button>}
            >
              {computed(() => routeInfo.value?.diagnostics[0]?.message ?? "Mapping details are unavailable.")}
            </Banner>
          )}</Show>
          <Show when={resolved}>{() => (
            <>
              <Rebuild value={card}>{(view) => view && <MappingCard detail={view[0]} info={view[1]} slugLabel={view[2]} onChange={openPicker} />}</Rebuild>
              <Show when={computed(() => detail.value?.kind === "collection")}>{() => (
                <>
                  <Field label="Slug field">{(field) => (
                    <Keyed value={slugChoices} by={choicesKey}>{(current) => {
                      const choices = current.value;
                      const model = followModel(() => pickListed(choices, storedSlugId.value));
                      return (
                        <Select
                          size="sm"
                          field={field}
                          modelValue={model}
                          on:change={(event) => {
                            const current = value.value;
                            if (!current) return;
                            onChange({
                              ...current,
                              route: {
                                kind: "entry-field",
                                fieldId: event.currentTarget.value,
                                ...(current.route.kind === "entry-field" && current.route.titleFieldId ? { titleFieldId: current.route.titleFieldId } : {}),
                              },
                            });
                          }}
                        >
                          {choices.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                        </Select>
                      );
                    }}</Keyed>
                  )}</Field>
                  <Field label="Entry title field">{(field) => (
                    <Keyed value={titleChoices} by={choicesKey}>{(current) => {
                      const choices = current.value;
                      const model = followModel(() => pickListed(choices, storedTitleId.value));
                      return (
                        <Select
                          size="sm"
                          field={field}
                          modelValue={model}
                          on:change={(event) => {
                            const current = value.value;
                            if (!current) return;
                            const titleFieldId = event.currentTarget.value;
                            onChange({
                              ...current,
                              route: {
                                kind: "entry-field",
                                fieldId: current.route.kind === "entry-field" ? current.route.fieldId : detail.value?.slugFields[0]?.id ?? "missing-slug-field",
                                ...(titleFieldId ? { titleFieldId } : {}),
                              },
                            });
                          }}
                        >
                          {choices.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                        </Select>
                      );
                    }}</Keyed>
                  )}</Field>
                </>
              )}</Show>
              <Rebuild value={computed(() => routeInfo.value)}>{(info) => info && (
                <>
                  {info.diagnostics.map((diagnostic, index) => (
                    <Banner
                      key={`${diagnostic.code}:${diagnostic.entryId ?? ""}:${index}`}
                      tone={info.status === "blocked" ? "err" : "warn"}
                    >
                      {diagnostic.message}
                    </Banner>
                  ))}
                </>
              )}</Rebuild>
            </>
          )}</Show>
        </>
      )}</Show>

      <MappingPickerDialog
        open={pickerOpen}
        catalog={catalog}
        onSelect={(ref) => void assign(ref)}
        onClose={() => { pickerOpen.value = false; }}
      />
    </div>
  );
}

export default MappingField;
