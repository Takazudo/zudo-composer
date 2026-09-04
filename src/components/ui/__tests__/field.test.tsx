import "./cleanup";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/preact";
import { Field } from "../field";
import { Input, Select, Textarea } from "../form-controls";

describe("Field", () => {
  it("labels the control it wraps without the caller repeating an id", () => {
    render(
      <Field label="Title">
        <Input />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Title" });
    expect(input.id).not.toBe("");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("marks a required field on the control, not only in the label", () => {
    render(
      <Field label="Slug" required>
        <Input />
      </Field>,
    );
    expect(screen.getByRole("textbox", { name: "Slug" })).toBeRequired();
    expect(screen.getByText("*")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows the kind hint beside the label", () => {
    render(
      <Field label="Body" kind="Markdown">
        <Textarea />
      </Field>,
    );
    expect(screen.getByText("Markdown").className).toBe("cms-field__kind");
  });

  it("describes the control with its help text", () => {
    render(
      <Field label="Slug" help="Lowercase, dashes only.">
        <Input />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Slug" });
    expect(input).toHaveAccessibleDescription("Lowercase, dashes only.");
  });

  it("turns the control invalid and describes it with the error", () => {
    render(
      <Field label="Slug" error="Already taken.">
        <Input />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Slug" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Already taken.");
  });

  it("describes the control with both help and error at once", () => {
    render(
      <Field label="Slug" help="Lowercase, dashes only." error="Already taken.">
        <Input />
      </Field>,
    );
    expect(screen.getByRole("textbox", { name: "Slug" })).toHaveAccessibleDescription(
      "Lowercase, dashes only. Already taken.",
    );
  });

  it("lets an explicit control prop win over the field wiring", () => {
    render(
      <Field label="Slug" controlId="own-slug" error="Already taken.">
        <Input id="explicit" aria-invalid="false" />
      </Field>,
    );
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("id", "explicit");
    expect(input).toHaveAttribute("aria-invalid", "false");
  });

  it("wires a Select the same way", () => {
    render(
      <Field label="Kind" help="Choose how the record renders.">
        <Select onChange={vi.fn()}>
          <option value="page">Page</option>
        </Select>
      </Field>,
    );
    const select = screen.getByRole("combobox", { name: "Kind" });
    expect(select).toHaveAccessibleDescription("Choose how the record renders.");
  });
});
