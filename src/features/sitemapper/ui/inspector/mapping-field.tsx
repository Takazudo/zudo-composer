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

export interface MappingFieldProps {
  value?: MappingSource;
  routeInfo?: SitemapNodeRouteInfo;
  catalog: MappingAssignmentCatalog;
  onChange: (source: SitemapPageSource) => void;
}

export function MappingField({ value, routeInfo, catalog, onChange }: MappingFieldProps): JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false);
  const detail = routeInfo?.mapping;

  const assign = async (ref: MappingRef): Promise<void> => {
    const mapping = await catalog.routes.resolveMapping(ref);
    if (mapping.status !== "resolved") return;
    const content = await catalog.routes.resolveContentSnapshot(mapping.record);
    if (content.status !== "resolved") return;
    const route = content.model.document.kind === "single"
      ? { kind: "single" as const }
      : { kind: "entry-field" as const, fieldId: content.model.document.fields.find((field) => field.kind === "slug")?.id ?? "missing-slug-field" };
    onChange({ kind: "mapping", ref, route });
  };

  const routeFieldId = value !== undefined && value.route.kind === "entry-field" ? value.route.fieldId : null;
  const slugFieldLabel = routeFieldId === null
    ? null
    : detail?.slugFields.find((field) => field.id === routeFieldId)?.label ?? routeFieldId;

  return (
    <div class="sg-sitemapper-source" role="group" aria-label="Mapping">
      {!value ? (
        <EmptyState
          inline
          icon={MappingIcon}
          title="No mapping assigned"
          action={<Button variant="primary" size="sm" onClick={() => setPickerOpen(true)}>Choose mapping…</Button>}
        />
      ) : (
        <>
          {!routeInfo ? <p role="status">Resolving mapping…</p> : null}
          {routeInfo && !detail ? (
            <Banner
              tone="err"
              title="Broken reference"
              action={<Button size="sm" onClick={() => setPickerOpen(true)}>Change…</Button>}
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
                <Button size="xs" variant="ghost" iconOnly aria-label="Change mapping" onClick={() => setPickerOpen(true)}>
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
