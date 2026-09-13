import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DEMO_EDITOR_HOSTS, resolveDemoEditorHost } from "../../scripts/demo-editor-hosts.mjs";

interface EditorField {
  prop: string;
  label?: string;
  editor?: { kind?: string };
  inlineEdit?: unknown;
}

interface EditorComponent {
  id: string;
  title?: string;
  fields?: EditorField[];
}

interface EditorSeed {
  hostId: string;
  project: SiteProject;
  componentPack: { components: EditorComponent[] };
}

interface SiteProject {
  id: string;
  name: string;
  activeSitemap?: { providerId: string; recordId: string };
  providers: {
    compositions: Array<{
      id: string;
      records: Array<{ document: CompositionDocument }>;
    }>;
    sitemaps?: Array<{
      id: string;
      records: Array<{ id: string; document: SitemapDocument }>;
    }>;
  };
}

interface CompositionDocument {
  id: string;
  name: string;
  root: CompositionNode[];
}

interface CompositionNode {
  id: string;
  componentId: string;
  props: Record<string, unknown>;
  slots?: Record<string, CompositionNode[]>;
}

interface SitemapDocument {
  root?: Array<{
    source?: { kind?: string; ref?: { recordId?: string } };
  }>;
}

export interface EditorManifest {
  hostId: string;
  projectId: string;
  routes: string[];
  assets: Record<string, { byteLength: number; mimeType: string; sha256: string }>;
}

export interface EditableCompositionText {
  compositionId: string;
  compositionName: string;
  providerId: string;
  nodeId: string;
  componentId: string;
  componentTitle: string;
  fieldProp: string;
  fieldLabel: string;
  originalValue: string;
}

export interface DemoEditorContext {
  name: keyof typeof DEMO_EDITOR_HOSTS;
  hostDir: string;
  artifactDir: string;
  manifest: EditorManifest;
  project: SiteProject;
  seed: EditorSeed;
  assetCount: number;
  editableText: EditableCompositionText;
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function findEditableText(project: SiteProject, componentPack: EditorComponent[]): EditableCompositionText {
  const components = new Map(componentPack.map((component) => [component.id, component]));
  const provider = project.providers.compositions.find((candidate) => candidate.id === "files") ?? project.providers.compositions[0];
  if (!provider) throw new Error("Editor seed does not contain a composition provider.");
  const activeSitemap = project.activeSitemap && project.providers.sitemaps
    ?.find((candidate) => candidate.id === project.activeSitemap?.providerId)
    ?.records.find((candidate) => candidate.id === project.activeSitemap?.recordId)?.document;
  const homeCompositionId = activeSitemap?.root?.[0]?.source?.kind === "composition"
    ? activeSitemap.root[0].source.ref?.recordId
    : undefined;

  const walk = (composition: CompositionDocument, node: CompositionNode): EditableCompositionText | undefined => {
    const component = components.get(node.componentId);
    const field = component?.fields?.find((candidate) => candidate.editor?.kind === "text"
      && candidate.inlineEdit !== undefined
      && typeof node.props[candidate.prop] === "string"
      && String(node.props[candidate.prop]).length > 0);
    if (field) {
      return {
        compositionId: composition.id,
        compositionName: composition.name,
        providerId: provider.id,
        nodeId: node.id,
        componentId: node.componentId,
        componentTitle: component?.title ?? node.componentId,
        fieldProp: field.prop,
        fieldLabel: field.label ?? field.prop,
        originalValue: String(node.props[field.prop]),
      };
    }
    for (const children of Object.values(node.slots ?? {})) {
      for (const child of children) {
        const result = walk(composition, child);
        if (result) return result;
      }
    }
    return undefined;
  };

  const records = [...provider.records].sort((left, right) => (
    Number(right.document.id === homeCompositionId) - Number(left.document.id === homeCompositionId)
  ));
  for (const record of records) {
    for (const node of record.document.root) {
      const result = walk(record.document, node);
      if (result) return result;
    }
  }
  throw new Error("Editor seed does not contain an inline-editable text field.");
}

/** Load the selected host's verified artifact metadata for the browser spec. */
export async function loadDemoEditorContext(environment: NodeJS.ProcessEnv = process.env): Promise<DemoEditorContext> {
  const requested = environment.DEMO_EDITOR_NAME;
  if (!requested || !Object.hasOwn(DEMO_EDITOR_HOSTS, requested)) {
    throw new Error("Use test:browser:demo-editor so the runner supplies a named editor host.");
  }
  const name = requested as keyof typeof DEMO_EDITOR_HOSTS;
  const hostDir = resolveDemoEditorHost(name);
  const artifactDir = resolve(environment.DEMO_EDITOR_ARTIFACT_ROOT ?? join(hostDir, "dist-editor"));
  const [manifestSource, seedSource, projectSource] = await Promise.all([
    readFile(join(artifactDir, "demo-editor-manifest.json"), "utf8"),
    readFile(join(artifactDir, "demo-editor-seed.json"), "utf8"),
    readFile(join(hostDir, "site-project.json"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource) as EditorManifest;
  const seed = JSON.parse(seedSource) as EditorSeed;
  const project = JSON.parse(projectSource) as SiteProject;
  assertRecord(manifest, "Demo editor manifest");
  assertRecord(seed, "Demo editor seed");
  if (manifest.hostId !== seed.hostId || manifest.projectId !== project.id || seed.project.id !== project.id) {
    throw new Error(`Demo editor ${name} artifact does not match its host project.`);
  }
  if (manifest.projectId !== seed.project.id || manifest.routes.length === 0) {
    throw new Error(`Demo editor ${name} artifact has no verified project routes.`);
  }
  return {
    name,
    hostDir,
    artifactDir,
    manifest,
    project,
    seed,
    assetCount: Object.keys(manifest.assets).length,
    editableText: findEditableText(project, seed.componentPack.components),
  };
}
