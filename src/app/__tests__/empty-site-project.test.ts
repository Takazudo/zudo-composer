import { createHash, webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeSiteProject, validateSiteProject } from "../../site-project";
import { SITE_PROJECT_PROVIDER_REGISTRY } from "../../site-project/model/provider-registry";
import { createTemporaryWorkspaceProviders } from "../../test/workspace-providers";
import { createEmptySiteProject, computeSiteProjectRevision } from "../empty-site-project";
import { createProductionProviderIntegration } from "../provider-integration";
import { ACTIVE_SITE_PROJECT_COMPONENT_PACK_REQUIREMENT, activeSiteProjectValidationContext } from "../site-project-manifest";

afterEach(() => vi.unstubAllGlobals());

describe("empty SiteProject", () => {
  it("creates a valid independent authoring graph with one unassigned root", () => {
    const project = createEmptySiteProject("My first site");
    const other = createEmptySiteProject("Another site");
    expect(validateSiteProject(project, activeSiteProjectValidationContext).ok).toBe(true);
    expect(project.name).toBe("My first site");
    expect(project.componentPack).toEqual(ACTIVE_SITE_PROJECT_COMPONENT_PACK_REQUIREMENT);
    expect(project.providers.sitemaps).toHaveLength(1);
    const sitemap = project.providers.sitemaps[0]!.records[0]!;
    expect(project.providers.sitemaps[0]!.records).toHaveLength(1);
    expect(project.activeSitemap).toEqual({ providerId: SITE_PROJECT_PROVIDER_REGISTRY.sitemaps["sitemap-filesystem"].logicalId, recordId: sitemap.id });
    expect(sitemap.document.navigation).toEqual({ primary: [], footer: [] });
    expect(sitemap.document.root).toEqual([{ id: expect.any(String), title: "Home", source: { kind: "unassigned" }, children: [] }]);
    expect(project.providers.compositions[0]!.records).toEqual([]);
    expect(project.providers.content[0]!.models).toEqual([]);
    expect(project.providers.content[0]!.entries).toEqual([]);
    expect(project.providers.mappings[0]!.records).toEqual([]);
    expect(other.id).not.toBe(project.id);
    expect(other.activeSitemap.recordId).not.toBe(sitemap.id);
    expect(other.providers.sitemaps[0]!.records[0]!.document.root[0]!.id).not.toBe(sitemap.document.root[0]!.id);
    sitemap.document.root[0]!.title = "Changed";
    expect(other.providers.sitemaps[0]!.records[0]!.document.root[0]!.title).toBe("Home");
  });

  it("computes the genuine canonical SHA-256 revision, including Unicode names", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const project = createEmptySiteProject("最初のサイト 🌱");
    const revision = await computeSiteProjectRevision(project);
    expect(revision).toMatch(/^[a-f0-9]{64}$/);
    expect(revision).toBe(createHash("sha256").update(serializeSiteProject(project), "utf8").digest("hex"));
    project.name = "Changed";
    expect(await computeSiteProjectRevision(project)).not.toBe(revision);
  });

  it("creates and reopens a workspace on an empty host where reset fails", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const host = await createTemporaryWorkspaceProviders();
    try {
      // Explicit null is essential: undefined injects the populated Vitest source.
      const empty = createProductionProviderIntegration({ project: null, createProviders: host.createProviders });
      await expect(empty.workspace.reset()).rejects.toThrow("Reset requires a valid source project");
      const project = createEmptySiteProject("First workspace");
      const revision = await computeSiteProjectRevision(project);
      const created = await empty.workspace.create(project, revision);
      expect(await created.initialization.initialize()).toEqual({ status: "ready" });
      expect(await created.getCurrentSiteProject()).toMatchObject({ status: "ready", project });
      expect((await created.workspace.metadata()).baselineRevision).toBe(revision);
      const reopened = createProductionProviderIntegration({ project: null, createProviders: host.createProviders });
      expect(await reopened.getCurrentSiteProject()).toMatchObject({ status: "ready", project });
    } finally {
      await host.dispose();
    }
  });
});
