import { describe, expect, it } from "vitest";
import { contentEntryLabel } from "../../content/presentation";
import {
  buildBindingRows,
  compatibleSourceGroups,
  compatibleTargetGroups,
  entryLabel,
  firstCompatibleTransform,
  parseRefKey,
  refKey,
  targetKey,
  unboundTargets,
} from "../presentation";
import {
  entry,
  EYEBROW_TARGET,
  FILL_TARGET,
  HEADING_TARGET,
  INCOMPATIBLE_BINDING,
  READY_BINDING,
  mappingRecord,
  model,
  openedHarness,
} from "./harness";

async function resolved(bindings = [READY_BINDING, INCOMPATIBLE_BINDING]) {
  const record = mappingRecord(bindings);
  const workspace = await openedHarness(record);
  return { record: workspace.controller.state.mapping!, definition: workspace.controller.state.definition! };
}

describe("Mapping binding rows", () => {
  it("gives every binding one row, in authored order, with its own diagnostics", async () => {
    const { record, definition } = await resolved();
    const rows = buildBindingRows(record, definition);

    expect(rows.map((row) => row.binding.id)).toEqual(["binding-title", "binding-flag"]);
    expect(rows.map((row) => row.index)).toEqual([0, 1]);
    expect(rows[0]!.source?.label).toBe("Title");
    expect(rows[0]!.target?.componentLabel).toBe("SectionHeading");
    expect(rows[0]!.status).toBe("ready");
    expect(rows[0]!.diagnostics).toEqual([]);

    // A boolean cannot drive a text prop under any transform.
    expect(rows[1]!.status).toBe("incompatible");
    expect(rows[1]!.diagnostics.map((item) => item.code)).toEqual(["incompatible-binding"]);
    expect(rows[1]!.diagnostics.every((item) => item.bindingId === "binding-flag")).toBe(true);
  });

  it("keeps a broken binding's stored ids visible instead of dropping the row", async () => {
    const drifted = mappingRecord([{
      id: "binding-gone",
      sourceFieldId: "field-removed",
      target: { nodeId: "node-removed", prop: "gone" },
      transform: { kind: "identity" },
    }]);
    const workspace = await openedHarness(drifted);
    const rows = buildBindingRows(workspace.controller.state.mapping!, workspace.controller.state.definition!);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBeNull();
    expect(rows[0]!.target).toBeNull();
    expect(rows[0]!.binding.sourceFieldId).toBe("field-removed");
    expect(rows[0]!.status).toBe("blocked");
  });

  it("always offers the stored transform, even when the pair admits none", async () => {
    const { record, definition } = await resolved();
    const rows = buildBindingRows(record, definition);

    expect(rows[0]!.transforms).toContain("identity");
    // Nothing is compatible here, but a select that cannot show its own value
    // would render empty.
    expect(rows[1]!.transforms).toEqual(["identity"]);
  });

  it("lists exactly the bindable props with no binding yet", async () => {
    const { record, definition } = await resolved([READY_BINDING]);
    const keys = unboundTargets(record, definition).map((target) => targetKey(target.target));

    expect(keys).not.toContain(targetKey(HEADING_TARGET));
    expect(keys).toContain(targetKey(EYEBROW_TARGET));
    expect(keys).toContain(targetKey(FILL_TARGET));
    expect(unboundTargets(record, null)).toEqual([]);
  });
});

describe("Mapping bind menu compatibility", () => {
  it("offers only sources that can drive the target, grouped by field kind", async () => {
    const { definition } = await resolved([]);
    const fill = definition.targets.find((target) => targetKey(target.target) === targetKey(FILL_TARGET))!;
    const heading = definition.targets.find((target) => targetKey(target.target) === targetKey(HEADING_TARGET))!;

    // Only the boolean field can reach a boolean prop.
    expect(compatibleSourceGroups(fill, model.document.fields).flatMap((group) => group.items.map((field) => field.id)))
      .toEqual(["field-flag"]);
    expect(compatibleSourceGroups(fill, model.document.fields).map((group) => group.label)).toEqual(["Boolean"]);

    // Every string-producing field can reach a text prop; the boolean cannot.
    const textSources = compatibleSourceGroups(heading, model.document.fields).flatMap((group) => group.items.map((field) => field.id));
    expect(textSources).toEqual(["field-title", "field-date", "field-slug"]);
    expect(textSources).not.toContain("field-flag");
  });

  it("offers only targets a source can drive, grouped by composition node", async () => {
    const { definition } = await resolved([]);
    const flag = model.document.fields.find((field) => field.id === "field-flag")!;
    const title = model.document.fields.find((field) => field.id === "field-title")!;

    const flagGroups = compatibleTargetGroups(flag, definition.targets);
    expect(flagGroups.flatMap((group) => group.items.map((target) => targetKey(target.target))))
      .toEqual([targetKey(FILL_TARGET)]);
    expect(flagGroups.map((group) => group.id)).toEqual(["grid-node"]);

    const titleTargets = compatibleTargetGroups(title, definition.targets)
      .flatMap((group) => group.items.map((target) => targetKey(target.target)));
    expect(titleTargets).toContain(targetKey(HEADING_TARGET));
    expect(titleTargets).not.toContain(targetKey(FILL_TARGET));
  });

  it("names a transform that makes a compatible pair work, and none for an impossible one", async () => {
    const { definition } = await resolved([]);
    const heading = definition.targets.find((target) => targetKey(target.target) === targetKey(HEADING_TARGET))!;

    expect(firstCompatibleTransform("text", heading)).toEqual({ kind: "identity" });
    expect(firstCompatibleTransform("boolean", heading)).toBeNull();
  });
});

describe("Mapping presentation helpers", () => {
  it("round-trips a provider-qualified record key", () => {
    expect(parseRefKey(refKey({ providerId: "content-indexeddb", recordId: "model-1" })))
      .toEqual({ providerId: "content-indexeddb", recordId: "model-1" });
  });

  it("labels a sample Entry with the Content route's own rule", () => {
    expect(entryLabel(entry, model)).toBe(contentEntryLabel(entry, model.document.fields));
    expect(entryLabel(entry, null)).toBe("Untitled Entry");
  });
});
