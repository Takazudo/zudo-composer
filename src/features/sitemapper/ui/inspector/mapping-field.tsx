/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type { MappingAssignmentCatalog, SitemapNodeRouteInfo } from "../../../../sitemapper/routes";
import type { MappingRef, SitemapPageSource } from "../../../../sitemapper/model";
import { MappingPickerDialog } from "../picker/mapping-picker-dialog";

type MappingSource = Extract<SitemapPageSource, { kind: "mapping" }>;

export interface MappingFieldProps { value?: MappingSource; routeInfo?: SitemapNodeRouteInfo; catalog: MappingAssignmentCatalog; onChange: (source: SitemapPageSource) => void }

export function MappingField({ value, routeInfo, catalog, onChange }: MappingFieldProps): JSX.Element {
  const [picker, setPicker] = useState(false);
  const detail = routeInfo?.mapping;
  const brokenReason = routeInfo?.diagnostics[0]?.message ?? "Mapping details are unavailable.";

  const assign = async (ref: MappingRef): Promise<void> => {
    const mapping = await catalog.routes.resolveMapping(ref);
    if (mapping.status !== "resolved") return;
    const content = await catalog.routes.resolveContentSnapshot(mapping.record);
    if (content.status !== "resolved") return;
    const route = content.model.document.kind === "single" ? { kind: "single" as const } : { kind: "entry-field" as const, fieldId: content.model.document.fields.find((field) => field.kind === "slug")?.id ?? "missing-slug-field" };
    onChange({ kind: "mapping", ref, route });
  };

  return <section class="sg-sitemapper-composition" aria-labelledby="sg-sitemapper-mapping-label">
    <h3 id="sg-sitemapper-mapping-label">Content Mapping</h3>
    {!value ? <div class="sg-sitemapper-composition__state"><p>No Content Mapping assigned.</p><button type="button" onClick={() => setPicker(true)}>Choose Content Mapping</button></div> :
      <div class={`sg-sitemapper-composition__state${routeInfo && !detail ? " sg-sitemapper-composition__state--broken" : ""}`} aria-busy={!routeInfo}>
        {!routeInfo && <p role="status">Resolving Mapping…</p>}
        {routeInfo && !detail && <p role="alert">Broken reference: {brokenReason}</p>}
        {routeInfo && detail && <><p><strong>{detail.name}</strong><span>{detail.model} · {detail.kind}</span></p><dl><div><dt>Readiness</dt><dd>{routeInfo.status === "ready" ? "Ready" : "Needs repair"}</dd></div><div><dt>Entries</dt><dd>{detail.entryCount}</dd></div><div><dt>Derived routes</dt><dd>{routeInfo.derivedRouteCount}</dd></div><div><dt>Sample path</dt><dd>{routeInfo.samplePath ?? "None"}</dd></div><div><dt>Route mode</dt><dd>{value.route.kind}</dd></div></dl>{routeInfo.diagnostics.map((diagnostic, index) => <p key={`${diagnostic.code}:${diagnostic.entryId ?? ""}:${index}`} role="alert">{diagnostic.message}</p>)}{detail.kind === "collection" && <label>Slug field<select value={value.route.kind === "entry-field" ? value.route.fieldId : ""} onChange={(event) => onChange({ ...value, route: { kind: "entry-field", fieldId: event.currentTarget.value } })}>{detail.slugFields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label>}</>}
        <div class="sg-sitemapper-composition__actions"><button type="button" onClick={() => setPicker(true)}>Replace Mapping</button><button type="button" class="sg-sitemapper-danger" onClick={() => onChange({ kind: "unassigned" })}>Clear Mapping</button></div>
      </div>}
    <MappingPickerDialog open={picker} catalog={catalog} onSelect={(ref) => void assign(ref)} onClose={() => setPicker(false)} />
  </section>;
}
