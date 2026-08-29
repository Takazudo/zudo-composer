/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { MappingAssignmentCatalog } from "../../../../sitemapper/routes";
import type { MappingRef, SitemapPageSource } from "../../../../sitemapper/model";
import { MappingPickerDialog } from "../picker/mapping-picker-dialog";

type MappingSource = Extract<SitemapPageSource, { kind: "mapping" }>;
type Detail =
  | { status: "idle" | "loading" }
  | { status: "broken"; reason: string }
  | { status: "ready"; name: string; model: string; kind: "single" | "collection"; entryCount: number; derivedRouteCount: number; samplePath?: string; diagnostics: readonly string[]; slugFields: readonly { id: string; label: string }[] };

export interface MappingFieldProps { value?: MappingSource; slug?: string; catalog: MappingAssignmentCatalog; onChange: (source: SitemapPageSource) => void }

function validEntrySlug(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const slug = value.trim();
  return slug.length > 0 && !/[/?#]/.test(slug) && slug !== "." && slug !== "..";
}

export function MappingField({ value, slug = "", catalog, onChange }: MappingFieldProps): JSX.Element {
  const [picker, setPicker] = useState(false);
  const [detail, setDetail] = useState<Detail>({ status: "idle" });

  useEffect(() => {
    if (!value) { setDetail({ status: "idle" }); return; }
    let active = true;
    setDetail({ status: "loading" });
    void catalog.routes.resolveMapping(value.ref).then(async (mapping) => {
      if (!active) return;
      if (mapping.status !== "resolved") {
        setDetail({ status: "broken", reason: mapping.status === "not-found" ? "Mapping not found." : mapping.reason });
        return;
      }
      const content = await catalog.routes.resolveContentSnapshot(mapping.record);
      if (!active) return;
      if (content.status !== "resolved") {
        setDetail({ status: "broken", reason: content.status === "not-found" ? "Content model not found." : content.reason });
        return;
      }
      const slugFields = content.model.document.fields.filter((field) => field.kind === "slug");
      const fieldId = value.route.kind === "entry-field" ? value.route.fieldId : undefined;
      const selectedField = content.model.document.fields.find((field) => field.id === fieldId);
      const routeField = selectedField?.kind === "slug" ? selectedField : undefined;
      const validSlugs = routeField ? content.snapshot.entries.map((entry) => entry.values[routeField.id]).filter(validEntrySlug) : [];
      const basePart = slug.replace(/^\/+|\/+$/g, "");
      const base = basePart ? `/${basePart}` : "/";
      const diagnostics: string[] = [];
      if (content.model.document.kind === "single" && value.route.kind !== "single") diagnostics.push("Single Content models require the single route mode.");
      if (content.model.document.kind === "collection" && value.route.kind !== "entry-field") diagnostics.push("Collection Content models require an Entry slug field.");
      else if (content.model.document.kind === "collection" && !selectedField) diagnostics.push("The selected Entry route field no longer exists.");
      else if (content.model.document.kind === "collection" && !routeField) diagnostics.push("The selected Entry route field is not a slug field.");
      if (routeField && validSlugs.length !== content.snapshot.entries.length) diagnostics.push("One or more Entries have missing or invalid slugs.");
      setDetail({
        status: "ready", name: mapping.record.document.name, model: content.model.document.name,
        kind: content.model.document.kind, entryCount: content.snapshot.count,
        derivedRouteCount: content.model.document.kind === "single" && value.route.kind === "single" ? 1 : validSlugs.length,
        samplePath: content.model.document.kind === "single" && value.route.kind === "single" ? base : validSlugs[0] ? `${base === "/" ? "" : base}/${encodeURIComponent(validSlugs[0].trim().normalize("NFC"))}` : undefined,
        diagnostics, slugFields,
      });
    }, (error) => active && setDetail({ status: "broken", reason: error instanceof Error ? error.message : "Mapping provider failed." }));
    return () => { active = false; };
  }, [value?.ref.providerId, value?.ref.recordId, value?.route.kind, value?.route.kind === "entry-field" ? value.route.fieldId : "", slug, catalog]);

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
      <div class={`sg-sitemapper-composition__state${detail.status === "broken" ? " sg-sitemapper-composition__state--broken" : ""}`} aria-busy={detail.status === "loading"}>
        {detail.status === "loading" && <p role="status">Resolving Mapping…</p>}
        {detail.status === "broken" && <p role="alert">Broken reference: {detail.reason}</p>}
        {detail.status === "ready" && <><p><strong>{detail.name}</strong><span>{detail.model} · {detail.kind}</span></p><dl><div><dt>Readiness</dt><dd>{detail.diagnostics.length === 0 ? "Ready" : "Needs repair"}</dd></div><div><dt>Entries</dt><dd>{detail.entryCount}</dd></div><div><dt>Derived routes</dt><dd>{detail.derivedRouteCount}</dd></div><div><dt>Sample path</dt><dd>{detail.samplePath ?? "None"}</dd></div><div><dt>Route mode</dt><dd>{value.route.kind}</dd></div></dl>{detail.diagnostics.map((diagnostic) => <p key={diagnostic} role="alert">{diagnostic}</p>)}{detail.kind === "collection" && <label>Slug field<select value={value.route.kind === "entry-field" ? value.route.fieldId : ""} onChange={(event) => onChange({ ...value, route: { kind: "entry-field", fieldId: event.currentTarget.value } })}>{detail.slugFields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label>}</>}
        <div class="sg-sitemapper-composition__actions"><button type="button" onClick={() => setPicker(true)}>Replace Mapping</button><button type="button" class="sg-sitemapper-danger" onClick={() => onChange({ kind: "unassigned" })}>Clear Mapping</button></div>
      </div>}
    <MappingPickerDialog open={picker} catalog={catalog} onSelect={(ref) => void assign(ref)} onClose={() => setPicker(false)} />
  </section>;
}
