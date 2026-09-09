import type { JsonValue } from "@zudo-composer/component-contract";
import { buildContentGraphIndex, contentEntryDigest, selectContentPublicationCandidate, type ContentSnapshot, type ContentPublicationSelection } from "../../content";
import { captureSiteProjectAssetLock } from "../assets/capture";
import { compileSiteProject } from "../compiler";
import { canonicalizeSiteProject, canonicalStringifyJson, compareUnicodeCodePoints, serializeSiteProject } from "../model/canonical";
import { validateSiteProject } from "../model/validation";
import type { SiteProject } from "../model";
import type { CompletedRelease, ReleaseChange, ReleasePlan, SiteProjectActiveSelection, SiteProjectApiDependencies } from "./types";

export const releaseJson = (value: unknown): string => canonicalStringifyJson(value as JsonValue);
export const sameRelease = (a: SiteProjectActiveSelection | null, b: SiteProjectActiveSelection | null) => releaseJson(a) === releaseJson(b);
export const contentSnapshots = (project: SiteProject): ContentSnapshot[] => project.providers.content.map((provider) => ({ providerId: provider.id, schemaVersion: 2, mutationToken: 0, models: provider.models, entries: provider.entries }));
export function releaseRecordChanges(before: SiteProject | null, after: SiteProject): ReleaseChange[] {
  const flatten = (project: SiteProject | null) => {
    const entries = new Map<string, { domain: string; providerId: string; recordId: string; value: unknown }>();
    if (!project) return entries;
    for (const domain of ["compositions", "content", "mappings", "sitemaps"] as const) for (const provider of project.providers[domain]) {
      const records = "records" in provider ? provider.records.map((record) => ({ kind: domain, record })) : [...provider.models.map((record) => ({ kind: "content-model", record })), ...provider.entries.map((record) => ({ kind: "content-entry", record }))];
      for (const { kind, record } of records) entries.set(JSON.stringify([kind, provider.id, record.id]), { domain: kind, providerId: provider.id, recordId: record.id, value: record });
    }
    entries.set("project", { domain: "project", providerId: "project", recordId: project.id, value: { name: project.name, activeSitemap: project.activeSitemap, collectionAttachments: project.collectionAttachments, componentPack: project.componentPack, providers: Object.fromEntries(Object.entries(project.providers).map(([domain, providers]) => [domain, providers.map(({ id }: { id: string }) => id)])) } });
    return entries;
  };
  const old = flatten(before), next = flatten(after), changes: ReleaseChange[] = [];
  for (const key of [...new Set([...old.keys(), ...next.keys()])].sort(compareUnicodeCodePoints)) {
    const a = old.get(key), b = next.get(key);
    if (a && b && releaseJson(a.value) === releaseJson(b.value)) continue;
    const { domain, providerId, recordId } = (b ?? a)!;
    changes.push({ domain, providerId, recordId, kind: !a ? "added" : !b ? "removed" : "changed" });
  }
  return changes;
}
export async function createReleasePlan(input: { project: SiteProject; workingPrecondition: JsonValue; baseline: SiteProject | null; baselineBuild?: CompletedRelease; selection: ContentPublicationSelection[]; expectedRevision: string | null; expectedActive: SiteProjectActiveSelection | null; storeGeneration: number }, dependencies: SiteProjectApiDependencies): Promise<ReleasePlan> {
  const workingProject = canonicalizeSiteProject(input.project);
  const selection = structuredClone(input.selection).sort((a, b) => compareUnicodeCodePoints(releaseJson(a), releaseJson(b)));
  const selected = selectContentPublicationCandidate(contentSnapshots(workingProject), input.baseline ? contentSnapshots(input.baseline) : [], selection);
  const rawCandidate = structuredClone(workingProject);
  rawCandidate.providers.content.forEach((provider) => { provider.entries = [...selected.find((snapshot) => snapshot.providerId === provider.id)!.entries]; });
  const candidate = canonicalizeSiteProject(rawCandidate);
  const validation = validateSiteProject(candidate, { componentPack: dependencies.componentCatalog.pack });
  const checks: ReleasePlan["checks"] = validation.ok ? [] : validation.diagnostics.map(({ code, message, path }) => ({ severity: "blocking", code, message, path }));
  const graph = buildContentGraphIndex(contentSnapshots(candidate));
  checks.push(...graph.diagnostics.map(({ code, message, providerId, recordId, path }) => ({ severity: "blocking" as const, code: `content-${code}`, message, path: releaseJson([providerId, recordId, path ?? []]) })));
  const assets = validation.ok ? await captureSiteProjectAssetLock(candidate, dependencies.componentCatalog, dependencies.assetStore) : undefined;
  if (assets?.status === "blocked") checks.push(...assets.diagnostics.map(({ code, message }) => ({ severity: "blocking" as const, code: `asset-${code}`, message, path: "$.assetLock" })));
  const assetLock = assets?.status === "ready" ? assets.lock ?? null : null;
  const compilation = validation.ok ? await (dependencies.compiler ?? compileSiteProject)(candidate, { componentCatalog: dependencies.componentCatalog, policy: "release", ...(assetLock ? { assetLock } : {}) }) : undefined;
  if (compilation?.status === "blocked") checks.push(...compilation.diagnostics.map(({ code, message, path }) => ({ severity: "blocking" as const, code, message, path })));
  if (!checks.length) checks.push({ severity: "info", code: "ready", message: "Candidate graph, routes and exact Assets inputs pass release checks.", path: "$" });
  const projectRevision = await dependencies.hash(serializeSiteProject(candidate));
  const toolchain = structuredClone(dependencies.toolchain);
  const buildId = await dependencies.hash(releaseJson({ projectRevision, assetLock, toolchain }));
  const changes = releaseRecordChanges(input.baseline, candidate);
  const beforePins = new Map((input.baselineBuild?.stage.assetLock?.pins ?? []).map((pin) => [releaseJson([pin.providerId, pin.assetId, pin.versionId]), pin]));
  const afterPins = new Map((assetLock?.pins ?? []).map((pin) => [releaseJson([pin.providerId, pin.assetId, pin.versionId]), pin]));
  for (const key of [...new Set([...beforePins.keys(), ...afterPins.keys()])].sort(compareUnicodeCodePoints)) {
    const before = beforePins.get(key), after = afterPins.get(key); if (before && after && releaseJson(before) === releaseJson(after)) continue;
    const pin = (after ?? before)!; changes.push({ domain: "assets", providerId: pin.providerId, recordId: pin.assetId, kind: !before ? "added" : !after ? "removed" : "changed" });
  }
  if (releaseJson(input.baselineBuild?.stage.toolchain ?? null) !== releaseJson(toolchain)) changes.push({ domain: "toolchain", providerId: "compiler", recordId: toolchain.compiler, kind: input.baselineBuild ? "changed" : "added" });
  const publication: ReleasePlan["publication"] = selection.flatMap(({ ref, action }) => {
    const entry = workingProject.providers.content.find(({ id }) => id === ref.providerId)?.entries.find(({ id, modelId }) => id === ref.recordId && modelId === ref.modelId);
    return entry ? [{ ref, expectedGeneration: entry.generation, expectedDigest: contentEntryDigest(entry), lifecycle: action === "publish" ? "published" as const : "draft" as const }] : [];
  });
  const affected: ReleasePlan["affected"] = changes.map(({ domain, providerId, recordId, kind }) => ({ kind: "record", identity: releaseJson([domain, providerId, recordId]), reason: kind }));
  if (compilation?.status === "ready") {
    const before = new Map((input.baselineBuild?.build.routes ?? []).map((route) => [route.pathname, route]));
    const after = new Map(compilation.build.routes.map((route) => [route.pathname, route]));
    for (const pathname of [...new Set([...before.keys(), ...after.keys()])].sort(compareUnicodeCodePoints)) if (releaseJson(before.get(pathname) ?? null) !== releaseJson(after.get(pathname) ?? null)) affected.push({ kind: "route", identity: pathname, reason: !before.has(pathname) ? "Added evaluated route." : !after.has(pathname) ? "Removed activated route." : "Evaluated route or dependency output changed." });
  }
  for (const pin of assetLock?.pins ?? []) affected.push({ kind: "assets", identity: releaseJson([pin.providerId, pin.assetId, pin.versionId]), reason: "Exact immutable byte dependency." });
  const body = { schemaVersion: 2 as const, workingProject, workingPrecondition: structuredClone(input.workingPrecondition), candidate, selection, expectedRevision: input.expectedRevision, expectedActive: input.expectedActive, storeGeneration: input.storeGeneration, projectRevision, buildId, assetLock, toolchain, changes, checks, affected, publication };
  return { ...body, planDigest: await dependencies.hash(releaseJson(body)) };
}
