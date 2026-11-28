import { computed, Show, signal, type Child } from "@takazudo/zfb/zudo-react";
import { followModel, memo, toSignal, type MaybeSignal } from "../../../../components/reactive";
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
  // The selects are rebuilt when the fields they offer change; their models follow the stored route.
  const slugOptions = computed(() => (detail.value?.slugFields ?? []).map((field) => `${field.id}\u0000${field.label}`).join("\u0001"));
  const titleOptions = computed(() => (detail.value?.titleFields ?? []).map((field) => `${field.id}\u0000${field.label}`).join("\u0001"));

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
              <Rebuild value={memo(() => [detail.value!, routeInfo.value!, slugFieldLabel.value] as const)}>{([currentDetail, info, slugLabel]) => (
                <div class="sg-sitemapper-source__card">
                  <MappingIcon size="sm" class="sg-sitemapper-source__glyph" />
                  <span class="sg-sitemapper-source__text">
                    <strong>{currentDetail.name}</strong>
                    <span>
                      {`${slugLabel ? `slug field: ${slugLabel} · ` : ""}${info.derivedRouteCount} ${info.derivedRouteCount === 1 ? "route" : "routes"}`}
                    </span>
                  </span>
                  <Chip tone={info.status === "ready" ? "ok" : "warn"} dot>{describeRouteStatus(info.status)}</Chip>
                  <Button size="xs" variant="ghost" iconOnly aria-label="Change mapping" on:click={openPicker}>
                    <EditIcon size="xs" />
                  </Button>
                </div>
              )}</Rebuild>
              <Show when={computed(() => detail.value?.kind === "collection")}>{() => (
                <>
                  <Field label="Slug field">{(field) => (
                    <Keyed value={slugOptions} by={(key) => key}>{() => {
                      const model = followModel(() => { const current = value.value; return current?.route.kind === "entry-field" ? current.route.fieldId : ""; });
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
                          {(detail.value?.slugFields ?? []).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                        </Select>
                      );
                    }}</Keyed>
                  )}</Field>
                  <Field label="Entry title field">{(field) => (
                    <Keyed value={titleOptions} by={(key) => key}>{() => {
                      const model = followModel(() => { const current = value.value; return current?.route.kind === "entry-field" ? current.route.titleFieldId ?? "" : ""; });
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
                          <option value="">Use page title</option>
                          {(detail.value?.titleFields ?? []).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                        </Select>
                      );
                    }}</Keyed>
                  )}</Field>
                </>
              )}</Show>
              <Rebuild value={computed(() => routeInfo.value!)}>{(info) => (
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
