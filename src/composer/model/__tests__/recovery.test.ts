import { describe, expect, it } from "vitest";
import { loadCompositionDocument, resetToSample } from "../recovery";
import { COMPONENT_IDS, createFixtureDocument, fixtureManifest } from "../../__tests__/fixtures";
import { COMPOSITION_SCHEMA_VERSION, type CompositionDocument } from "../types";
import { classifyNode } from "../validate";

const sample = (): CompositionDocument => createFixtureDocument();

describe("loadCompositionDocument", () => {
  it("returns a fresh sample when nothing is stored", () => {
    const outcome = loadCompositionDocument(null, sample());
    expect(outcome.status).toBe("fresh");
    expect(outcome.document.id).toBe("sample");
  });

  it("loads a structurally valid stored document as-is", () => {
    const stored = sample();
    stored.name = "Edited";
    const outcome = loadCompositionDocument(JSON.stringify(stored), sample());
    expect(outcome.status).toBe("ok");
    expect(outcome.document.name).toBe("Edited");
  });

  it("preserves structured props while unknown and version-mismatched nodes stay opaque", () => {
    const actions = [{ label: "Read docs", href: "/docs", variant: "secondary" }];
    const stored = sample();
    stored.root = [
      { id: "unknown", componentId: "ghost.hero", componentVersion: 1, props: { actions }, slots: {} },
      { id: "future", componentId: COMPONENT_IDS.box, componentVersion: 99, props: { actions }, slots: {} },
    ];

    const outcome = loadCompositionDocument(JSON.stringify(stored), sample());
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.document.root.map((node) => node.props.actions)).toEqual([actions, actions]);
    expect(outcome.document.root.map((node) => classifyNode(node, fixtureManifest).opaque)).toEqual([true, true]);
  });

  it("recovers older schema prototypes instead of migrating them", () => {
    const outcome = loadCompositionDocument(
      JSON.stringify({ ...sample(), schemaVersion: COMPOSITION_SCHEMA_VERSION - 1 }),
      sample(),
    );
    expect(outcome.status).toBe("recovered");
  });

  it("recovers to the sample on unparseable JSON", () => {
    const outcome = loadCompositionDocument("{not json", sample());
    expect(outcome.status).toBe("recovered");
    if (outcome.status !== "recovered") return;
    expect(outcome.document.id).toBe("sample");
    expect(outcome.reason).toMatch(/json/i);
  });

  it("recovers to the sample when the supported-schema document is malformed", () => {
    const malformed = JSON.stringify({
      schemaVersion: COMPOSITION_SCHEMA_VERSION,
      id: "x",
      name: "x",
      root: "not-an-array",
    });
    const outcome = loadCompositionDocument(malformed, sample());
    expect(outcome.status).toBe("recovered");
  });

  it("recovers when there is no supported schemaVersion", () => {
    const outcome = loadCompositionDocument(JSON.stringify({ id: "x", name: "x", root: [] }), sample());
    expect(outcome.status).toBe("recovered");
  });

  it("quarantines a future schema WITHOUT overwriting the raw storage", () => {
    const future = JSON.stringify({
      schemaVersion: COMPOSITION_SCHEMA_VERSION + 1,
      id: "future",
      name: "Future",
      root: [],
    });
    const outcome = loadCompositionDocument(future, sample());
    expect(outcome.status).toBe("quarantined");
    if (outcome.status !== "quarantined") return;
    expect(outcome.foundSchemaVersion).toBe(COMPOSITION_SCHEMA_VERSION + 1);
    expect(outcome.quarantinedRaw).toBe(future); // raw preserved for a newer build
    expect(outcome.document.id).toBe("sample"); // sample surfaced to work in
  });
});

describe("resetToSample", () => {
  it("returns an independent clone of the sample", () => {
    const original = sample();
    const reset = resetToSample(original);
    reset.name = "changed";
    expect(original.name).not.toBe("changed");
  });
});
