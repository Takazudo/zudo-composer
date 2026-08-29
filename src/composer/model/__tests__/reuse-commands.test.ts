import { describe, expect, it } from "vitest";
import {
  addNode,
  bindConsumer,
  clearPublication,
  createSequentialIdFactory,
  insertSubtree,
  moveSubtree,
  publishGlobalTemplate,
  publishPattern,
  reassignGlobalTemplateOutlet,
  removeBinding,
  removeNode,
  renameGlobalTemplateOutlet,
  setGlobalTemplateOutlet,
} from "../../index";
import type {
  CompositionDocument,
  ResolvedGlobalTemplateOutletContract,
  RootPolicy,
} from "../../index";
import { COMPONENT_IDS as C, SLOT_IDS as S } from "../../__tests__/fixtures";
import { FIXTURE_COMPONENT_IDS as X, doc, fixtureManifest as M, node } from "../../__tests__/fixtures";

const target = { parentId: "owner", slotId: S.stackChildren };
const rootTarget = { parentId: null, slotId: "root", index: 0 } as const;
const resolvedBoxRoot: Extract<RootPolicy, { kind: "resolved" }> = {
  kind: "resolved",
  accepts: [X.box],
  cardinality: "single",
};

function globalCandidate(): CompositionDocument {
  return doc([node(C.stack, {}, { [S.stackChildren]: [] }, "owner")]);
}

function bindContract(overrides: Partial<ResolvedGlobalTemplateOutletContract> = {}): ResolvedGlobalTemplateOutletContract {
  return {
    sourceRecordId: "source-record",
    outletId: "outlet-main",
    sameProvider: true,
    sourceIsGlobalTemplate: true,
    sourceHasBinding: false,
    rootPolicy: resolvedBoxRoot,
    ...overrides,
  };
}

describe("publication and outlet commands", () => {
  it("requires an explicit non-empty role transition and generates a stable outlet id once", () => {
    expect(publishPattern(doc([])).ok).toBe(false);

    const published = publishGlobalTemplate(globalCandidate(), M, target, "Main content", createSequentialIdFactory("id"));
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(published.document.publication).toMatchObject({
      kind: "global-template",
      outlet: { id: "outlet-1", label: "Main content", target },
    });

    // A role is never inferred from a label/target, and switching requires an
    // explicit clear before the next explicit publish command.
    expect(publishPattern(published.document).ok).toBe(false);
    const cleared = clearPublication(published.document, { dependentCount: 0 });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    const pattern = publishPattern(cleared.document);
    expect(pattern.ok).toBe(true);
    if (!pattern.ok) return;
    expect(pattern.document.publication).toEqual({ kind: "pattern" });
  });

  it("accepts only a real, declared, empty component slot and preserves the stable id on edits", () => {
    const occupied = doc([
      node(C.stack, {}, { [S.stackChildren]: [node(X.box, {}, {}, "inside")] }, "owner"),
    ]);
    expect(publishGlobalTemplate(occupied, M, target, "Main", createSequentialIdFactory()).ok).toBe(false);
    expect(
      publishGlobalTemplate(globalCandidate(), M, { parentId: "owner", slotId: "not-real" }, "Main", createSequentialIdFactory()).ok,
    ).toBe(false);

    const twoSlotDocument = doc([
      node(C.splitLayout, {}, { [S.splitLeft]: [], [S.splitRight]: [] }, "owner"),
    ]);
    const firstTarget = { parentId: "owner", slotId: S.splitLeft };
    const secondTarget = { parentId: "owner", slotId: S.splitRight };
    const first = publishGlobalTemplate(twoSlotDocument, M, firstTarget, "Main", createSequentialIdFactory());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const firstPublication = first.document.publication;
    if (firstPublication?.kind !== "global-template") throw new Error("expected global template");
    const renamed = renameGlobalTemplateOutlet(first.document, "Article body");
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    const reassigned = reassignGlobalTemplateOutlet(renamed.document, M, secondTarget);
    expect(reassigned.ok).toBe(true);
    if (!reassigned.ok) return;
    expect(reassigned.document.publication).toMatchObject({
      outlet: { id: firstPublication.outlet.id },
    });
    const set = setGlobalTemplateOutlet(reassigned.document, M, secondTarget, "Body", createSequentialIdFactory());
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.document.publication).toMatchObject({
      outlet: { id: firstPublication.outlet.id, label: "Body" },
    });
  });

  it("guards known dependents when clearing publication without trusting a UI preflight", () => {
    const published = publishGlobalTemplate(globalCandidate(), M, target, "Main", createSequentialIdFactory());
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    const blocked = clearPublication(published.document, { dependentCount: 1 });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.code).toBe("dependent-bindings");
    expect(published.document.publication?.kind).toBe("global-template");
  });

  it("blocks every local insertion path into a reserved outlet and owner/ancestor deletion", () => {
    const nested = doc([
      node(
        C.stack,
        {},
        { [S.stackChildren]: [node(C.stack, {}, { [S.stackChildren]: [] }, "owner")] },
        "ancestor",
      ),
      node(X.box, {}, {}, "outside"),
    ]);
    const published = publishGlobalTemplate(nested, M, target, "Main", createSequentialIdFactory());
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    const outletTarget = { ...target, index: 0 };

    const add = addNode(published.document, M, outletTarget, X.box, createSequentialIdFactory());
    expect(add.ok).toBe(false);
    if (!add.ok) expect(add.code).toBe("outlet-reserved");
    expect(insertSubtree(published.document, M, outletTarget, node(X.box, {}, {}, "pasted")).ok).toBe(false);
    expect(moveSubtree(published.document, M, "outside", outletTarget).ok).toBe(false);

    const removeOwner = removeNode(published.document, M, "owner");
    expect(removeOwner.ok).toBe(false);
    if (!removeOwner.ok) expect(removeOwner.code).toBe("outlet-owner-removal");
    expect(removeNode(published.document, M, "ancestor").ok).toBe(false);
  });
});

describe("binding and effective consumer-root policy", () => {
  it("binds only a resolved same-provider, non-nested external source and keeps local nodes canonical", () => {
    const local = doc([node(X.box, { label: "local" }, {}, "local")]);
    const bound = bindConsumer(local, bindContract());
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    expect(bound.document.binding).toEqual({ sourceRecordId: "source-record", outletId: "outlet-main" });
    expect(bound.document.root[0]!.id).toBe("local");
    expect(bindConsumer(local, bindContract({ sourceRecordId: local.id })).ok).toBe(false);
    expect(bindConsumer(local, bindContract({ sameProvider: false })).ok).toBe(false);
    expect(bindConsumer(local, bindContract({ sourceHasBinding: true })).ok).toBe(false);
    expect(publishPattern(bound.document).ok).toBe(false);

    const unbound = removeBinding(bound.document);
    expect(unbound.ok).toBe(true);
    if (unbound.ok) expect(unbound.document.root).toEqual(bound.document.root);
  });

  it("uses the resolver policy consistently for virtual-root add, subtree insertion, and cross-slot move", () => {
    const bound = doc([]);
    bound.binding = { sourceRecordId: "source-record", outletId: "outlet-main" };
    expect(addNode(bound, M, rootTarget, X.box, createSequentialIdFactory(), resolvedBoxRoot).ok).toBe(true);
    expect(addNode(bound, M, rootTarget, C.stack, createSequentialIdFactory(), resolvedBoxRoot).ok).toBe(false);
    expect(insertSubtree(bound, M, rootTarget, node(X.box, {}, {}, "paste"), resolvedBoxRoot).ok).toBe(true);
    expect(insertSubtree(bound, M, rootTarget, node(C.stack, {}, { [S.stackChildren]: [] }, "bad"), resolvedBoxRoot).ok).toBe(false);

    const nested = doc([
      node(C.stack, {}, { [S.stackChildren]: [node(X.box, {}, {}, "move-me")] }, "container"),
    ]);
    nested.binding = { sourceRecordId: "source-record", outletId: "outlet-main" };
    const moved = moveSubtree(nested, M, "move-me", { parentId: null, slotId: "root", index: 1 }, {
      kind: "resolved",
      accepts: [X.box],
      cardinality: "many",
    });
    expect(moved.ok).toBe(true);
  });

  it("blocks new root insertions while unresolved but preserves safe removal and reordering", () => {
    const bound = doc([node(X.box, {}, {}, "one"), node(X.box, {}, {}, "two")]);
    bound.binding = { sourceRecordId: "source-record", outletId: "outlet-main" };
    const before = JSON.parse(JSON.stringify(bound));
    const blocked = addNode(bound, M, rootTarget, X.box, createSequentialIdFactory());
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("unresolved-root-policy");
    expect(bound).toEqual(before);

    expect(removeNode(bound, M, "one").ok).toBe(true);
    const reordered = moveSubtree(bound, M, "one", { parentId: null, slotId: "root", index: 2 });
    expect(reordered.ok).toBe(true);
  });
});
