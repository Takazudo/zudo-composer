import { describe, expect, it } from "vitest";
import {
  createComponentCatalog,
  createSequentialIdFactory,
  isStructurallyValidDocument,
  linkedEditorPresentation,
  materializeBrokenBindingRemoval,
  materializeGlobalTemplateView,
  materializeStandaloneSnapshot,
  materializedRuntimeKey,
  resolveGlobalTemplate,
  type ComponentDefinition,
  type CompositionNode,
  type CompositionRecord,
  type MaterializedViewNode,
} from "../../index";
import { createFixturePackManifest } from "../../__tests__/fixtures";

const TIMESTAMP = "2026-07-14T00:00:00.000Z";

const manifest = createComponentCatalog(createFixturePackManifest([
  {
    id: "shell",
    schemaVersion: 1,
    title: "shell",
    category: "Fixture",
    description: "shell",
    source: { module: "test", exportKind: "named", exportName: "Shell" },
    defaults: {},
    fields: [{ prop: "label", label: "Label", schema: { type: "string" }, editor: { kind: "text" } }],
    slots: [
      { id: "header", prop: "header", label: "Header", cardinality: "many" },
      { id: "body", prop: "body", label: "Body", accepts: ["leaf", "shell"], cardinality: "many" },
      { id: "footer", prop: "footer", label: "Footer", cardinality: "many" },
    ],
  },
  {
    id: "leaf",
    schemaVersion: 1,
    title: "leaf",
    category: "Fixture",
    description: "leaf",
    source: { module: "test", exportKind: "named", exportName: "Leaf" },
    defaults: {},
    fields: [{ prop: "label", label: "Label", schema: { type: "string" }, editor: { kind: "text" } }],
    slots: [],
  },
] satisfies ComponentDefinition[]));

function node(
  id: string,
  componentId = "leaf",
  slots: Record<string, CompositionNode[]> = {},
): CompositionNode {
  return { id, componentId, componentVersion: 1, props: { label: id }, slots };
}

function record(id: string, document: Partial<CompositionRecord["document"]> = {}): CompositionRecord {
  return {
    id,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    document: {
      schemaVersion: 2,
      id,
      name: id,
      root: [],
      ...document,
    },
  };
}

function source(): CompositionRecord {
  return record("source", {
    root: [
      node("shell", "shell", {
        header: [node("shared-id")],
        body: [
          node("nested", "shell", {
            header: [],
            body: [],
            footer: [],
          }),
        ],
        footer: [node("footer")],
      }),
    ],
    publication: {
      kind: "global-template",
      outlet: {
        id: "outlet-main",
        label: "Main content",
        target: { parentId: "nested", slotId: "body" },
      },
    },
  });
}

function consumer(root = [node("shared-id"), node("local-second")]): CompositionRecord {
  return record("consumer", {
    root,
    binding: { sourceRecordId: "source", outletId: "outlet-main" },
  });
}

function find(node: MaterializedViewNode, id: string): MaterializedViewNode | undefined {
  if (node.id === id) return node;
  for (const children of Object.values(node.slots)) {
    for (const child of children) {
      const result = find(child, id);
      if (result) return result;
    }
  }
  return undefined;
}

describe("Global-template transient materialization", () => {
  it("projects multi-root local content into a nested source outlet without changing either canonical document", () => {
    const template = source();
    const bound = consumer();
    const sourceBefore = structuredClone(template);
    const consumerBefore = structuredClone(bound);
    const resolution = resolveGlobalTemplate({ consumer: bound, source: template, manifest });
    expect(resolution.status).toBe("resolved");

    const view = materializeGlobalTemplateView(bound, resolution);
    expect(view).toMatchObject({
      status: "resolved",
      outlet: { id: "outlet-main", target: { parentId: "nested", slotId: "body" } },
      localRootTarget: { parentId: null, slotId: "root", owner: { kind: "local", recordId: "consumer" } },
      output: { preview: "available", export: "available" },
      affordances: { detach: "snapshot" },
    });
    if (view.status !== "resolved") throw new Error("expected resolved view");

    const shell = view.renderRoot[0]!;
    const nested = find(shell, "nested")!;
    expect(shell.slots.header.map((child) => child.id)).toEqual(["shared-id"]);
    expect(nested.slots.body.map((child) => child.id)).toEqual(["shared-id", "local-second"]);
    expect(shell.slots.footer.map((child) => child.id)).toEqual(["footer"]);
    expect(nested.slots.body.every((child) => child.owner.kind === "local")).toBe(true);
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    expect(template).toEqual(sourceBefore);
    expect(bound).toEqual(consumerBefore);

    // The view owns clones too: a renderer must not be able to alter canonical data through it.
    view.sourceDocument.root[0]!.props.label = "changed transiently";
    view.localDocument.root[0]!.props.label = "changed transiently";
    expect(template).toEqual(sourceBefore);
    expect(bound).toEqual(consumerBefore);
  });

  it("uses owner-qualified runtime identities when source and local node ids deliberately collide", () => {
    const template = source();
    const bound = consumer();
    const resolution = resolveGlobalTemplate({ consumer: bound, source: template, manifest });
    const view = materializeGlobalTemplateView(bound, resolution);
    if (view.status !== "resolved") throw new Error("expected resolved view");

    const sourceCollision = view.renderRoot[0]!.slots.header[0]!;
    const localCollision = find(view.renderRoot[0]!, "nested")!.slots.body[0]!;
    expect(sourceCollision.id).toBe(localCollision.id);
    expect(sourceCollision.owner).toMatchObject({ kind: "global-template", sourceRecordId: "source" });
    expect(localCollision.owner).toMatchObject({ kind: "local", recordId: "consumer" });
    expect(sourceCollision.runtimeKey).not.toBe(localCollision.runtimeKey);
    expect(sourceCollision.runtimeKey).toBe(materializedRuntimeKey(sourceCollision.owner, "shared-id"));
    expect(localCollision.runtimeKey).toBe(materializedRuntimeKey(localCollision.owner, "shared-id"));
  });

  it("projects into a declared source slot that is canonically represented by an omitted empty array", () => {
    const template = source();
    delete template.document.root[0]!.slots.body[0]!.slots.body;
    const bound = consumer();
    const resolution = resolveGlobalTemplate({ consumer: bound, source: template, manifest });
    expect(resolution.status).toBe("resolved");

    const view = materializeGlobalTemplateView(bound, resolution);
    expect(view.status).toBe("resolved");
    if (view.status !== "resolved") throw new Error("expected resolved view");
    expect(find(view.renderRoot[0]!, "nested")!.slots.body.map((child) => child.id)).toEqual([
      "shared-id",
      "local-second",
    ]);
  });

  it("keeps every resolver failure bare, editable, binding-preserving, and output-blocked", () => {
    const bound = consumer();
    const missing = resolveGlobalTemplate({ consumer: bound, source: record("other"), manifest });
    expect(missing.status).toBe("missing-template");

    const view = materializeGlobalTemplateView(bound, missing);
    expect(view).toMatchObject({
      status: "blocked",
      renderRoot: [
        { id: "shared-id", owner: { kind: "local", recordId: "consumer" } },
        { id: "local-second", owner: { kind: "local", recordId: "consumer" } },
      ],
      output: { preview: "blocked", export: "blocked" },
      diagnostic: {
        code: "missing-template",
        binding: { sourceRecordId: "source", outletId: "outlet-main" },
        affordances: { retry: true, detach: "remove-broken-binding" },
      },
    });
    expect("sourceDocument" in view).toBe(false);
    expect(view.localDocument.binding).toEqual(bound.document.binding);
    expect(bound.document.root.map((entry) => entry.id)).toEqual(["shared-id", "local-second"]);
  });

  it("fails safely if an externally edited source changes after a resolved result was obtained", () => {
    const template = source();
    const bound = consumer();
    const resolution = resolveGlobalTemplate({ consumer: bound, source: template, manifest });
    expect(resolution.status).toBe("resolved");

    // A stale resolution must never overwrite source-owned children at an outlet.
    template.document.root[0]!.slots.body[0]!.slots.body.push(node("externally-added"));
    const staleOutlet = materializeGlobalTemplateView(bound, resolution);
    expect(staleOutlet).toMatchObject({
      status: "blocked",
      diagnostic: { code: "invalid-materialization" },
    });
    expect(staleOutlet.renderRoot.map((entry) => entry.id)).toEqual(["shared-id", "local-second"]);

    // The same recheck rejects a source that becomes a nested consumer.
    const templateWithBinding = source();
    const nestedResolution = resolveGlobalTemplate({ consumer: bound, source: templateWithBinding, manifest });
    templateWithBinding.document.binding = { sourceRecordId: "another-source", outletId: "other-outlet" };
    expect(materializeGlobalTemplateView(bound, nestedResolution)).toMatchObject({
      status: "blocked",
      diagnostic: { code: "invalid-materialization" },
    });

    // A stale unbound outcome cannot accidentally make a still-bound consumer exportable.
    const staleUnbound = resolveGlobalTemplate({ consumer: record("unbound"), source: templateWithBinding, manifest });
    expect(staleUnbound.status).toBe("unbound");
    expect(materializeGlobalTemplateView(bound, staleUnbound)).toMatchObject({
      status: "blocked",
      diagnostic: { code: "invalid-materialization" },
    });
  });
});

describe("standalone Global-template snapshots", () => {
  it("rekeys the projected source/local forest into an ordinary valid document with no relation metadata", () => {
    const template = source();
    const bound = consumer();
    const sourceBefore = structuredClone(template);
    const consumerBefore = structuredClone(bound);
    const resolution = resolveGlobalTemplate({ consumer: bound, source: template, manifest });
    let snapshotNumber = 0;
    const snapshot = materializeStandaloneSnapshot(bound, resolution, () => `snapshot-${++snapshotNumber}`);

    expect(snapshot.status).toBe("materialized");
    if (snapshot.status !== "materialized") throw new Error("expected snapshot");
    expect(snapshot.document).toMatchObject({
      schemaVersion: 2,
      id: "consumer",
      name: "consumer",
      root: [
        {
          componentId: "shell",
          slots: {
            header: [{ componentId: "leaf" }],
            body: [{ componentId: "shell", slots: { body: [{ componentId: "leaf" }, { componentId: "leaf" }] } }],
            footer: [{ componentId: "leaf" }],
          },
        },
      ],
    });
    expect(snapshot.document).not.toHaveProperty("binding");
    expect(snapshot.document).not.toHaveProperty("publication");
    expect(isStructurallyValidDocument(snapshot.document)).toBe(true);
    expect(template).toEqual(sourceBefore);
    expect(bound).toEqual(consumerBefore);

    const ids = new Set<string>();
    const visit = (nodes: typeof snapshot.document.root): void => {
      for (const entry of nodes) {
        expect(ids.has(entry.id)).toBe(false);
        ids.add(entry.id);
        visit(entry.slots.body ?? []);
        visit(entry.slots.header ?? []);
        visit(entry.slots.footer ?? []);
      }
    };
    visit(snapshot.document.root);
    expect([...ids].every((id) => id.startsWith("snapshot-"))).toBe(true);
  });

  it("refuses failed resolutions and non-fresh ids without returning a partial snapshot", () => {
    const template = source();
    const bound = consumer();
    const incompatible = consumer([node("wrong", "unknown", {})]);
    const incompatibleResolution = resolveGlobalTemplate({ consumer: incompatible, source: template, manifest });
    const before = structuredClone(incompatible);
    expect(materializeStandaloneSnapshot(incompatible, incompatibleResolution, createSequentialIdFactory())).toMatchObject({
      status: "blocked",
      reason: "resolution-failed",
    });
    expect(incompatible).toEqual(before);

    const resolution = resolveGlobalTemplate({ consumer: bound, source: template, manifest });
    expect(materializeStandaloneSnapshot(bound, resolution, () => "shared-id")).toMatchObject({
      status: "blocked",
      reason: "id-factory-failure",
    });
  });

  it("makes broken-binding removal explicit and preserves only canonical local content", () => {
    const bound = consumer();
    bound.document.publication = { kind: "pattern" };
    const removed = materializeBrokenBindingRemoval(bound.document);

    expect(removed).toMatchObject({
      status: "removed-broken-binding",
      document: {
        id: "consumer",
        name: "consumer",
        root: [{ id: "shared-id" }, { id: "local-second" }],
      },
    });
    expect(removed.document).not.toHaveProperty("binding");
    expect(removed.document).not.toHaveProperty("publication");
    expect(removed.document.root[0]).not.toBe(bound.document.root[0]);
  });
});

describe("linked editor presentation", () => {
  it("exposes only source identity/status, never source nodes or a provider capability", () => {
    const template = source();
    const bound = consumer();
    const resolution = resolveGlobalTemplate({ consumer: bound, source: template, manifest });
    const view = materializeGlobalTemplateView(bound, resolution);
    expect(linkedEditorPresentation(view)).toEqual({
      state: "resolved",
      sourceRecordId: "source",
      sourceName: "source",
      outletId: "outlet-main",
      outletLabel: "Main content",
    });
  });

  it("keeps a broken binding visible and local content independent", () => {
    const bound = consumer();
    const failed = resolveGlobalTemplate({ consumer: bound, source: record("other"), manifest });
    const view = materializeGlobalTemplateView(bound, failed);
    expect(linkedEditorPresentation(view)).toMatchObject({
      state: "blocked",
      sourceRecordId: "source",
      diagnostic: "missing-template",
    });
  });
});
