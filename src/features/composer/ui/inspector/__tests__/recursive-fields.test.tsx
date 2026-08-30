/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../../test-support/cleanup";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/preact";
import type { ComponentManifest, FieldDefinition } from "@zudo-composer/component-contract";
import type { CompositionDocument, JsonObject } from "../../../../../composer/browser";
import { createComponentCatalog } from "../../../../../composer/browser";
import { resetTestIds } from "../../test-support/composer-fixtures";
import { InspectorPanel } from "../inspector-panel";

const actionsField = {
  prop: "actions",
  label: "Actions",
  schema: {
    type: "array",
    items: {
      schema: {
        type: "object",
        fields: [
          { key: "label", label: "Label", required: true, schema: { type: "string" }, editor: { kind: "text" } },
          { key: "href", label: "URL", required: true, schema: { type: "string" }, editor: { kind: "text" } },
          { key: "variant", label: "Variant", schema: { type: "string", enum: ["primary", "secondary"] }, editor: { kind: "select" } },
        ],
      },
      editor: { kind: "group" },
    },
  },
  editor: { kind: "list" },
} as FieldDefinition;

const settingsField = {
  prop: "settings",
  label: "Settings",
  schema: {
    type: "object",
    fields: [
      { key: "enabled", label: "Enabled", required: true, schema: { type: "boolean" }, editor: { kind: "boolean" } },
      { key: "note", label: "Note", schema: { type: "string" }, editor: { kind: "text" } },
    ],
  },
  editor: { kind: "group" },
} as FieldDefinition;

const tupleField = {
  prop: "layout",
  label: "Layout",
  schema: {
    type: "tuple",
    items: [
      { label: "Direction", schema: { type: "string", enum: ["row", "column"] }, editor: { kind: "select" } },
      { label: "Columns", schema: { type: "number", min: 1, max: 4, step: 1 }, editor: { kind: "number" } },
    ],
  },
  editor: { kind: "tuple" },
} as FieldDefinition;

const tagsField = {
  prop: "tags",
  label: "Tags",
  schema: { type: "array", items: { schema: { type: "string" }, editor: { kind: "text" } } },
  editor: { kind: "list" },
} as FieldDefinition;

const manifest = createComponentCatalog({
  kind: "zudo-composer/component-pack",
  contractVersion: 2,
  packId: "@test/recursive-inspector",
  packVersion: "1.0.0",
  components: [
    {
      id: "test.hero",
      schemaVersion: 1,
      title: "Hero",
      category: "Content",
      description: "Recursive inspector fixture.",
      source: { module: "@test/ui", exportKind: "named", exportName: "Hero" },
      defaults: {
        actions: [{ label: "Get started", href: "#", variant: "primary" }],
        settings: { enabled: true },
        layout: ["row", 2],
      },
      fields: [actionsField, settingsField, tupleField, tagsField],
      slots: [],
    },
  ] satisfies readonly ComponentManifest[],
});

function documentWith(props: JsonObject): CompositionDocument {
  return {
    schemaVersion: 2,
    id: "recursive-doc",
    name: "Recursive",
    root: [{ id: "hero", componentId: "test.hero", componentVersion: 1, props, slots: {} }],
  };
}

function renderInspector(props: JsonObject = { actions: [{ label: "Get started", href: "#", variant: "primary" }], settings: { enabled: true }, layout: ["row", 2] }) {
  const onUpdateProps = vi.fn();
  const onUpdatePropsDebounced = vi.fn();
  render(
    <InspectorPanel
      document={documentWith(props)}
      manifest={manifest}
      selectedId="hero"
      mode="edit"
      onUpdateProps={onUpdateProps}
      onUpdatePropsDebounced={onUpdatePropsDebounced}
      onReorder={() => undefined}
      onRemove={() => undefined}
    />,
  );
  return { onUpdateProps, onUpdatePropsDebounced };
}

beforeEach(() => resetTestIds());

describe("recursive contract-v2 inspector fields", () => {
  it("edits a Hero action at its exact nested path and keeps records as raw JSON", () => {
    const { onUpdatePropsDebounced } = renderInspector();
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    fireEvent.input(screen.getByLabelText("Label"), { target: { value: "Launch" } });

    expect(onUpdatePropsDebounced).toHaveBeenCalledWith(
      "hero",
      { actions: [{ label: "Launch", href: "#", variant: "primary" }] },
      [["actions", 0, "label"]],
    );
  });

  it("uses structural null checkpoints for add/remove/reorder and optional object keys", () => {
    const { onUpdateProps } = renderInspector();
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(onUpdateProps).toHaveBeenNthCalledWith(
      1,
      "hero",
      { actions: [
        { label: "Get started", href: "#", variant: "primary" },
        { label: "", href: "" },
      ] },
      null,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Note" }));
    expect(onUpdateProps).toHaveBeenNthCalledWith(2, "hero", {
      settings: { enabled: true, note: "" },
    }, null);

    fireEvent.click(screen.getByRole("button", { name: "Remove Note" }));
    expect(onUpdateProps).toHaveBeenNthCalledWith(3, "hero", { settings: { enabled: true } }, null);

    const actionsList = document.querySelector('[data-sg-inspector-list="actions"]');
    expect(actionsList).not.toBeNull();
    fireEvent.click(within(actionsList as HTMLElement).getAllByRole("button", { name: "Move down" })[0]!);
    expect(onUpdateProps).toHaveBeenNthCalledWith(4, "hero", {
      actions: [
        { label: "", href: "" },
        { label: "Get started", href: "#", variant: "primary" },
      ],
    }, null);
  });

  it("keeps invalid values blocked but exposes declared fields as an accessible recovery path", () => {
    const { onUpdateProps } = renderInspector({ actions: [{ label: "A", href: "#", variant: "tertiary" }], settings: { enabled: true }, layout: ["row", 2] });
    expect(screen.getByText(/invalid properties/i, { selector: "p" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    const variant = screen.getByLabelText("Variant");
    expect(variant).toHaveAttribute("aria-invalid", "true");
    expect(screen.getAllByRole("alert").some((alert) => /allowed options/i.test(alert.textContent ?? ""))).toBe(true);
    fireEvent.change(variant, { target: { value: "secondary" } });
    expect(onUpdateProps).toHaveBeenCalledWith("hero", {
      actions: [{ label: "A", href: "#", variant: "secondary" }],
    }, [["actions", 0, "variant"]]);
    expect(screen.queryByRole("button", { name: "Add item" })).toBeInTheDocument();
    expect(screen.getByLabelText("Columns")).toHaveAttribute("type", "number");
  });

  it("removes an optional top-level prop through the explicit omission channel", () => {
    const { onUpdateProps } = renderInspector();
    fireEvent.click(screen.getByRole("button", { name: "Remove Settings" }));
    expect(onUpdateProps).toHaveBeenCalledWith("hero", {}, null, ["settings"]);
  });

  it("keeps primitive list items directly editable while object items remain collapsible", () => {
    const { onUpdatePropsDebounced } = renderInspector({
      actions: [{ label: "A", href: "#", variant: "primary" }],
      settings: { enabled: true },
      layout: ["row", 2],
      tags: ["one"],
    });
    const tag = screen.getByLabelText("Item 1") as HTMLInputElement;
    expect(tag).toHaveValue("one");
    fireEvent.input(tag, { target: { value: "two" } });
    expect(onUpdatePropsDebounced).toHaveBeenCalledWith("hero", { tags: ["two"] }, [["tags", 0]]);
  });
});
