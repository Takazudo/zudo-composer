import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  COMPONENT_PACK_KIND,
  CONTRACT_VERSION,
  type ComponentPackManifest,
} from "@zudo-composer/component-contract";
import { defineSite } from "../../../src/site-project/authoring";
import type { SiteProject } from "../../../src/site-project/model";
import { createFilesystemWorkspaceRegistry } from "../../../src/app/workspace-filesystem/registry";
import { workspaceScopedRoot } from "../../../src/shared/workspace-scope";
import { createFilesystemCompositionStore } from "../../../src/composer/storage/filesystem";
import type { CompositionRecord } from "../../../src/composer/library";
import { buildHostGrammar, loadGrammarTemplates, resolveActiveCompositionsRoot, selectGrammarTemplate, type GrammarHostPaths } from "../grammar";

const revision = "a".repeat(64);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makePaths(): Promise<GrammarHostPaths> {
  const sandbox = await mkdtemp(join(tmpdir(), "grammar-cli-"));
  roots.push(sandbox);
  return {
    data: join(sandbox, "cms"),
    compositions: join(sandbox, "cms/compositions"),
    content: join(sandbox, "cms/content"),
    mappings: join(sandbox, "cms/mappings"),
    sitemaps: join(sandbox, "cms/sitemaps"),
  };
}

/** A minimal typed `SiteProject` — the registry only needs the shape, not a real provider pack. */
function minimalSiteProject(): SiteProject {
  const site = defineSite({ id: "grammar-cli-test", name: "Grammar CLI test", componentPack: { manifest: pack() } });
  const home = site.page({ name: "Home", root: [] });
  site.sitemap({ name: "Test sitemap", root: { title: "Home", page: home } });
  return site.toSiteProject();
}

/** Select a workspace, the same way `seed`/the dev server's own workspace client does. */
async function activateWorkspace(paths: GrammarHostPaths, id = "alpha"): Promise<string> {
  const registry = await createFilesystemWorkspaceRegistry({ registryRoot: join(paths.data, "workspaces") });
  await registry.create(minimalSiteProject(), revision, id);
  await registry.complete(id);
  return workspaceScopedRoot(paths.compositions, id);
}

function pack(): ComponentPackManifest {
  return {
    kind: COMPONENT_PACK_KIND,
    contractVersion: CONTRACT_VERSION,
    packId: "grammar-cli-test",
    packVersion: "1.0.0",
    components: [
      {
        id: "demo.body",
        schemaVersion: 1,
        title: "Body",
        category: "Fixture",
        description: "Demo container.",
        source: { module: "@fixtures/demo", exportKind: "named", exportName: "Body" },
        defaults: {},
        fields: [],
        slots: [{ id: "content", prop: "children", label: "Main content", cardinality: "many", min: 1, accepts: ["demo.note"] }],
      },
      {
        id: "demo.note",
        schemaVersion: 1,
        title: "Note",
        category: "Fixture",
        description: "Demo leaf.",
        source: { module: "@fixtures/demo", exportKind: "named", exportName: "Note" },
        defaults: {},
        fields: [],
        slots: [],
      },
    ],
  };
}

function templateRecord(id: string, name: string): CompositionRecord {
  return {
    id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    document: {
      schemaVersion: 2,
      id,
      name,
      root: [{ id: "body-1", componentId: "demo.body", componentVersion: 1, props: {}, slots: { content: [] } }],
      publication: {
        kind: "global-template",
        outlet: { id: "main", label: "Main content", target: { parentId: "body-1", slotId: "content" } },
      },
    },
  };
}

function staleTemplateRecord(id: string, name: string): CompositionRecord {
  const record = templateRecord(id, name);
  record.document.publication = {
    kind: "global-template",
    outlet: { id: "main", label: "Main content", target: { parentId: "missing", slotId: "content" } },
  };
  return record;
}

function ordinaryRecord(id: string, name: string): CompositionRecord {
  return {
    id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    document: { schemaVersion: 2, id, name, root: [] },
  };
}

describe("resolveActiveCompositionsRoot", () => {
  it("is undefined when the host has never selected a workspace", async () => {
    const paths = await makePaths();
    expect(await resolveActiveCompositionsRoot(paths)).toBeUndefined();
  });

  it("scopes the compositions root to the registry's active selection", async () => {
    const paths = await makePaths();
    const scopedRoot = await activateWorkspace(paths);
    expect(await resolveActiveCompositionsRoot(paths)).toBe(scopedRoot);
  });
});

describe("loadGrammarTemplates", () => {
  it("is empty when no workspace is selected, and reads every Composition once one is", async () => {
    const paths = await makePaths();
    expect(await loadGrammarTemplates({ paths })).toEqual([]);

    const scopedRoot = await activateWorkspace(paths);
    const store = await createFilesystemCompositionStore({ compositionsRoot: scopedRoot, provideJsx: () => "export default null;" });
    await store.put(templateRecord("category-page", "Category page"), "export default null;");
    await store.put(ordinaryRecord("about", "About"), "export default null;");

    const documents = await loadGrammarTemplates({ paths });
    expect(documents.map((document) => document.id).sort()).toEqual(["about", "category-page"]);
  });
});

describe("buildHostGrammar", () => {
  it("builds the grammar from the host's resolved pack and active workspace", async () => {
    const paths = await makePaths();
    const scopedRoot = await activateWorkspace(paths);
    const store = await createFilesystemCompositionStore({ compositionsRoot: scopedRoot, provideJsx: () => "export default null;" });
    await store.put(templateRecord("category-page", "Category page"), "export default null;");
    await store.put(ordinaryRecord("about", "About"), "export default null;");

    const grammar = await buildHostGrammar({ componentPack: pack(), paths });
    expect(grammar.pack).toEqual({ id: "grammar-cli-test", version: "1.0.0" });
    expect(grammar.templates).toHaveLength(1);
    expect(grammar.templates[0]).toMatchObject({ id: "category-page", open: false });
    expect(grammar.openRoot).toEqual({ accepts: "any" });
  });
});

describe("selectGrammarTemplate", () => {
  it("narrows to the one named template and throws for an unknown id", async () => {
    const paths = await makePaths();
    const scopedRoot = await activateWorkspace(paths);
    const store = await createFilesystemCompositionStore({ compositionsRoot: scopedRoot, provideJsx: () => "export default null;" });
    await store.put(templateRecord("category-page", "Category page"), "export default null;");
    await store.put(templateRecord("landing-page", "Landing page"), "export default null;");

    const grammar = await buildHostGrammar({ componentPack: pack(), paths });
    expect(selectGrammarTemplate(grammar, "landing-page").templates.map((template) => template.id)).toEqual(["landing-page"]);
    expect(() => selectGrammarTemplate(grammar, "missing-page")).toThrow(/is not a published Global template/);
  });

  it("narrows to a valid template even when another template's outlet is broken", async () => {
    const paths = await makePaths();
    const scopedRoot = await activateWorkspace(paths);
    const store = await createFilesystemCompositionStore({ compositionsRoot: scopedRoot, provideJsx: () => "export default null;" });
    await store.put(templateRecord("category-page", "Category page"), "export default null;");
    await store.put(staleTemplateRecord("stale-page", "Stale page"), "export default null;");

    const grammar = await buildHostGrammar({ componentPack: pack(), paths });
    expect(grammar.templates.map((template) => template.id)).toEqual(["category-page"]);
    expect(grammar.unavailableTemplates.map((template) => template.id)).toEqual(["stale-page"]);

    const selected = selectGrammarTemplate(grammar, "category-page");
    expect(selected.templates.map((template) => template.id)).toEqual(["category-page"]);
    expect(selected.unavailableTemplates).toEqual([]);
  });

  it("throws a clear error when the named template itself is unavailable", async () => {
    const paths = await makePaths();
    const scopedRoot = await activateWorkspace(paths);
    const store = await createFilesystemCompositionStore({ compositionsRoot: scopedRoot, provideJsx: () => "export default null;" });
    await store.put(staleTemplateRecord("stale-page", "Stale page"), "export default null;");

    const grammar = await buildHostGrammar({ componentPack: pack(), paths });
    expect(() => selectGrammarTemplate(grammar, "stale-page")).toThrow(
      'Global template "stale-page" is unavailable: outlet target "missing" was not found.',
    );
  });
});
