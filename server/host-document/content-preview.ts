import { z } from "zod";
import type { ComponentPackManifest } from "@zudo-composer/component-contract";
import type { AuthoringWorkspaceSnapshot, compileAuthoringWorkspaceSnapshot } from "../authoring-workspace/capture";
import type { ContentEntryRef } from "../../src/content/model";
import type { HostContentContext, HostContentUse } from "../../src/shared/host-content-preview";
import { describeHostFieldSources } from "./field-sources";
import { hostDocumentTargets } from "./render";
const entrySchema = z.object({ providerId: z.string().min(1), modelId: z.string().min(1), recordId: z.string().min(1) }).strict();
export const hostContentContextInput = z.object({ workspaceId: z.string().min(1), entry: entrySchema }).strict();
export const hostContentDocumentInput = hostContentContextInput.extend({ revision: z.string().regex(/^[a-f0-9]{64}$/), sitemapProviderId: z.string().min(1), sitemapId: z.string().min(1), pageId: z.string().min(1), pathname: z.string().startsWith("/") }).strict();
const refuse = (code: string, message: string): never => { throw Object.assign(new Error(message), { code }); };
const sameEntry = (a: ContentEntryRef, b: ContentEntryRef) => a.providerId === b.providerId && a.modelId === b.modelId && a.recordId === b.recordId;
export function describeHostContent(snapshot: AuthoringWorkspaceSnapshot, compiled: Awaited<ReturnType<typeof compileAuthoringWorkspaceSnapshot>>, manifest: ComponentPackManifest, input: z.infer<typeof hostContentContextInput>): HostContentContext {
  if (snapshot.workspaceId !== input.workspaceId) return refuse("wrong-workspace", "Workspace changed.");
  const provider = snapshot.project.providers.content.find(provider => provider.id === input.entry.providerId);
  const record = provider?.entries.find(entry => entry.id === input.entry.recordId && entry.modelId === input.entry.modelId);
  if (!record || !provider?.models.some(model => model.id === input.entry.modelId)) return refuse("not-found", "The qualified saved Content entry is unavailable.");
  const routes = compiled.build.routes.map(route => ({ route, targets: hostDocumentTargets(route) }));
  const sources = describeHostFieldSources(snapshot.project, manifest, routes);
  const uses: HostContentUse[] = [];
  for (const { route, targets } of routes) {
    const matches = targets.flatMap(target => sources(route, target).flatMap(field => field.sources.filter(source => sameEntry(source.entry, input.entry)).map(source => ({ target: { renderedNodeId: target.renderedNodeId, providerId: target.providerId, recordId: target.recordId, nodeId: target.nodeId }, ...(source.fieldId ? { fieldId: source.fieldId } : {}), fieldLabel: source.fieldLabel, prop: field.prop }))));
    if (matches.length) uses.push({ sitemapProviderId: compiled.build.activeSitemap.providerId, sitemapId: compiled.build.activeSitemap.recordId, pageId: route.sitemapNode.id, pathname: route.pathname, title: route.displayTitle, targets: [...new Map(matches.map(match => [JSON.stringify(match), match])).values()] });
  }
  return { mode: "saved-page", workspaceId: snapshot.workspaceId, revision: snapshot.digest, entry: { ...input.entry }, record: structuredClone(record), pack: { packId: manifest.packId, packVersion: manifest.packVersion }, renderer: { id: snapshot.renderer.id, version: snapshot.renderer.version, digest: snapshot.renderer.digest }, uses,
    unsupported: "Unsaved Content drafts and standalone Mapping fragments cannot be rendered by this host preview. Uses include compiled bindings only; host-only metadata dependencies are not inferred." };
}
export function selectHostContentUse(context: HostContentContext, input: z.infer<typeof hostContentDocumentInput>): HostContentUse {
  if (context.workspaceId !== input.workspaceId || !sameEntry(context.entry, input.entry)) return refuse("wrong-target", "The qualified Content owner differs.");
  if (context.revision !== input.revision) return refuse("stale-plan", "Saved Content context changed. Refresh affected pages.");
  const matches = context.uses.filter(use => use.sitemapProviderId === input.sitemapProviderId && use.sitemapId === input.sitemapId && use.pageId === input.pageId && use.pathname === input.pathname);
  if (matches.length !== 1) return refuse("not-found", "Choose one captured affected page for this Content entry.");
  return matches[0]!;
}
