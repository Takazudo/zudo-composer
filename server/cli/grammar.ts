// `zudo-composer grammar` — build + render the composition grammar for agents.
//
// The CMS compositions root is workspace-scoped (`<compositionsDir>/workspace-
// v1-<id>/`): the browser resolves which workspace is active through the
// registry and sends it as a header on every composition request (see
// `plugins/composer-file-provider-plugin.mjs`). This CLI has no browser, so it
// repeats that same resolution — read the registry's current selection, then
// scope the compositions root with it — before loading the host's templates.
// A host with no selected workspace yet (freshly created, never seeded)
// contributes no templates; `buildGrammar` still returns the pack + openRoot.

import type { ComponentPackManifest } from "@zudo-composer/component-contract";
import { resolveWorkspaceRegistryRoot } from "../../plugins/workspace-domain-provider.mjs";
import { buildGrammar, type Grammar } from "../../src/composer/grammar";
import { createComponentCatalog } from "../../src/composer/model/types";
import type { CompositionDocument } from "../../src/composer/model/types";
import { createFilesystemCompositionStore } from "../../src/composer/storage/filesystem";
import { workspaceScopedRoot } from "../../src/shared/workspace-scope";
import { createWorkspaceRegistryService } from "../../src/app/workspace-filesystem/dev-server-entry";
import type { ComposerPaths } from "../config/config";

export { renderGrammarMarkdown } from "../../src/composer/grammar";

export type GrammarHostPaths = Pick<ComposerPaths, "data" | "compositions" | "content" | "mappings" | "sitemaps">;

/** The active workspace's compositions root, or `undefined` when none is selected. */
export async function resolveActiveCompositionsRoot(paths: GrammarHostPaths): Promise<string | undefined> {
  const registry = await createWorkspaceRegistryService({
    registryRoot: resolveWorkspaceRegistryRoot(paths.data),
    domainRoots: { compositions: paths.compositions, content: paths.content, mappings: paths.mappings, sitemaps: paths.sitemaps },
  });
  const active = await registry.selection();
  return active === null ? undefined : workspaceScopedRoot(paths.compositions, active);
}

export interface LoadGrammarTemplatesOptions {
  paths: GrammarHostPaths;
}

/** Read every Composition in the host's active workspace. */
export async function loadGrammarTemplates(options: LoadGrammarTemplatesOptions): Promise<CompositionDocument[]> {
  const compositionsRoot = await resolveActiveCompositionsRoot(options.paths);
  if (compositionsRoot === undefined) return [];
  const store = await createFilesystemCompositionStore({
    compositionsRoot,
    provideJsx: () => {
      throw new Error("zudo-composer grammar never generates JSX.");
    },
  });
  const { records } = await store.snapshot();
  return records.map((record) => record.document);
}

export interface BuildHostGrammarOptions {
  componentPack: ComponentPackManifest;
  paths: GrammarHostPaths;
}

/** Build the full-pack grammar from the host's resolved pack and active workspace. */
export async function buildHostGrammar(options: BuildHostGrammarOptions): Promise<Grammar> {
  const manifest = createComponentCatalog(options.componentPack);
  const templates = await loadGrammarTemplates({ paths: options.paths });
  return buildGrammar({ manifest, templates });
}

/** Narrow a built grammar to the one named template. */
export function selectGrammarTemplate(grammar: Grammar, templateId: string): Grammar {
  const template = grammar.templates.find((entry) => entry.id === templateId);
  if (template) return { ...grammar, templates: [template], unavailableTemplates: [] };
  const unavailable = grammar.unavailableTemplates.find((entry) => entry.id === templateId);
  if (unavailable) {
    throw new Error(`Global template "${templateId}" is unavailable: ${unavailable.reason}`);
  }
  throw new Error(`"${templateId}" is not a published Global template in this host.`);
}
