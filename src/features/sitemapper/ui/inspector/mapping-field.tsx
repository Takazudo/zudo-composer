/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useState } from "preact/hooks";
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
  value?: MappingSource;
  routeInfo?: SitemapNodeRouteInfo;
  catalog: MappingAssignmentCatalog;
  onChange: (source: SitemapPageSource) => void;
}

export function MappingField({ value, routeInfo, catalog, onChange }: MappingFieldProps): JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const detail = routeInfo?.mapping;

  const assign = async (ref: MappingRef): Promise<void> => {
    setAssignError(null);
    try {
      const mapping = await catalog.routes.resolveMapping(ref);
      if (mapping.status !== "resolved") {
        setAssignError(describeAssignFailure("That Mapping", mapping));
        return;
      }
      const content = await catalog.routes.resolveContentSnapshot(mapping.record);
      if (content.status !== "resolved") {
        setAssignError(describeAssignFailure("That Mapping's content model", content));
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
        setAssignError(`“${content.model.document.name}” has no slug field, so it derives no routes.`);
        return;
      }
      onChange({ kind: "mapping", ref, route: { kind: "entry-field", fieldId: slugField.id } });
    } catch (reason) {
      setAssignError(reason instanceof Error ? reason.message : "That Mapping could not be assigned.");
    }
  };

  const routeFieldId = value !== undefined && value.route.kind === "entry-field" ? value.route.fieldId : null;
  const slugFieldLabel = routeFieldId === null
    ? null
    : detail?.slugFields.find((field) => field.id === routeFieldId)?.label ?? routeFieldId;

  return (
    <div class="sg-sitemapper-source" role="group" aria-label="Mapping">
      {assignError ? <Banner tone="err">{assignError}</Banner> : null}
      {!value ? (
        <EmptyState
          inline
          icon={MappingIcon}
          title="No mapping assigned"
          action={<Button variant="primary" size="sm" onClick={() => { setAssignError(null); setPickerOpen(true); }}>Choose mapping…</Button>}
        />
      ) : (
        <>
          {!routeInfo ? <p role="status">Resolving mapping…</p> : null}
          {routeInfo && !detail ? (
            <Banner
              tone="err"
              title="Broken reference"
              action={<Button size="sm" onClick={() => { setAssignError(null); setPickerOpen(true); }}>Change…</Button>}
            >
              {routeInfo.diagnostics[0]?.message ?? "Mapping details are unavailable."}
            </Banner>
          ) : null}
          {routeInfo && detail ? (
            <>
              <div class="sg-sitemapper-source__card">
                <MappingIcon size="sm" class="sg-sitemapper-source__glyph" />
                <span class="sg-sitemapper-source__text">
                  <strong>{detail.name}</strong>
                  <span>
                    {slugFieldLabel ? `slug field: ${slugFieldLabel} · ` : ""}
                    {routeInfo.derivedRouteCount} {routeInfo.derivedRouteCount === 1 ? "route" : "routes"}
                  </span>
                </span>
                <Chip tone={routeInfo.status === "ready" ? "ok" : "warn"} dot>{describeRouteStatus(routeInfo.status)}</Chip>
                <Button size="xs" variant="ghost" iconOnly aria-label="Change mapping" onClick={() => { setAssignError(null); setPickerOpen(true); }}>
                  <EditIcon size="xs" />
                </Button>
              </div>
              {detail.kind === "collection" ? (
                <>
                  <Field label="Slug field">
                    <Select
                      size="sm"
                      value={value.route.kind === "entry-field" ? value.route.fieldId : ""}
                      onChange={(event) => onChange({
                        ...value,
                        route: {
                          kind: "entry-field",
                          fieldId: event.currentTarget.value,
                          ...(value.route.kind === "entry-field" && value.route.titleFieldId ? { titleFieldId: value.route.titleFieldId } : {}),
                        },
                      })}
                    >
                      {detail.slugFields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
                    </Select>
                  </Field>
                  <Field label="Entry title field">
                    <Select
                      size="sm"
                      value={value.route.kind === "entry-field" ? value.route.titleFieldId ?? "" : ""}
                      onChange={(event) => {
                        const titleFieldId = event.currentTarget.value;
                        onChange({
                          ...value,
                          route: {
                            kind: "entry-field",
                            fieldId: value.route.kind === "entry-field" ? value.route.fieldId : detail.slugFields[0]?.id ?? "missing-slug-field",
                            ...(titleFieldId ? { titleFieldId } : {}),
                          },
                        });
                      }}
                    >
                      <option value="">Use page title</option>
                      {detail.titleFields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
                    </Select>
                  </Field>
                </>
              ) : null}
              {routeInfo.diagnostics.map((diagnostic, index) => (
                <Banner
                  key={`${diagnostic.code}:${diagnostic.entryId ?? ""}:${index}`}
                  tone={routeInfo.status === "blocked" ? "err" : "warn"}
                >
                  {diagnostic.message}
                </Banner>
              ))}
            </>
          ) : null}
        </>
      )}

      <MappingPickerDialog
        open={pickerOpen}
        catalog={catalog}
        onSelect={(ref) => void assign(ref)}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}

export default MappingField;
