import { describe, expect, it } from "vitest";
import {
  COMPONENT_PACK_KIND,
  CONTRACT_VERSION,
  type ComponentManifest,
} from "@zudo-composer/component-contract";
import { updateProps } from "../commands";
import { loadCompositionDocument } from "../recovery";
import {
  COMPOSITION_SCHEMA_VERSION,
  createComponentCatalog,
  type CompositionDocument,
  type JsonObject,
} from "../types";

const hero: ComponentManifest = {
  id: "ui.hero", schemaVersion: 1, title: "Hero", category: "Content", description: "Hero fixture",
  source: { module: "@fixtures/hero", exportKind: "named", exportName: "Hero" },
  defaults: { actions: [{ label: "Default", href: "/" }] },
  fields: [{
    prop: "actions", label: "Actions",
    schema: { type: "array", items: {
      schema: { type: "object", fields: [
        { key: "label", label: "Label", required: true, schema: { type: "string" }, editor: { kind: "text" } },
        { key: "href", label: "URL", required: true, schema: { type: "string" }, editor: { kind: "text" } },
        { key: "variant", label: "Variant", schema: { type: "string", enum: ["primary", "secondary"] }, editor: { kind: "select" } },
      ] },
      editor: { kind: "group" },
    } },
    editor: { kind: "list" },
  }],
  slots: [],
};
const manifest = createComponentCatalog({
  kind: COMPONENT_PACK_KIND,
  contractVersion: CONTRACT_VERSION,
  packId: "@fixtures/hero",
  packVersion: "1.0.0",
  components: [hero],
});
const initial: CompositionDocument = {
  schemaVersion: COMPOSITION_SCHEMA_VERSION,
  id: "hero-doc",
  name: "Hero",
  root: [{ id: "hero", componentId: "ui.hero", componentVersion: 1, props: hero.defaults, slots: {} }],
};

describe("Hero.actions model round-trip", () => {
  it("validates, persists, reloads, and reparses the exact records", () => {
    const actions: JsonObject[] = [
      { label: "Read docs", href: "/docs", variant: "secondary" },
      { label: "Start", href: "/start" },
    ];
    const updated = updateProps(initial, manifest, "hero", { actions });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    const loaded = loadCompositionDocument(JSON.stringify(updated.document), initial);
    expect(loaded.status).toBe("ok");
    if (loaded.status !== "ok") return;
    expect(loaded.document.root[0]!.props.actions).toEqual(actions);
    expect(updateProps(loaded.document, manifest, "hero", { actions })).toMatchObject({ ok: true });
  });

  it("rejects missing record keys and invalid variants with exact paths", () => {
    const missing = updateProps(initial, manifest, "hero", { actions: [{ label: "Broken" }] });
    expect(missing).toMatchObject({ ok: false });
    if (!missing.ok) expect(missing.error).toContain("$props.actions[0].href");

    const variant = updateProps(initial, manifest, "hero", {
      actions: [{ label: "Broken", href: "/", variant: "tertiary" }],
    });
    expect(variant).toMatchObject({ ok: false });
    if (!variant.ok) expect(variant.error).toContain("$props.actions[0].variant");
  });
});
