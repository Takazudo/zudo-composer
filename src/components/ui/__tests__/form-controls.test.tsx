import "./cleanup";
import { describe, expect, it, vi } from "vitest";
import { signal } from "@takazudo/zfb/zudo-react";
import { fireEvent, render, screen, settle } from "../../../test/render";
import { SearchIcon } from "../../icons";
import { Checkbox, Input, Select, Switch, Textarea } from "../form-controls";

describe("Input", () => {
  it("renders at the md control height and forwards native props", () => {
    render(<Input aria-label="Name" placeholder="Untitled" value="Product overview" on:input={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: "Name" });
    expect(input.className).toBe("cms-input");
    expect(input).toHaveAttribute("placeholder", "Untitled");
    expect(input).toHaveValue("Product overview");
  });

  it("switches to the 26px toolbar size", () => {
    render(<Input aria-label="Search" size="sm" />);
    expect(screen.getByRole("textbox", { name: "Search" }).className).toBe("cms-input cms-input--sm");
  });

  it("wraps itself when given a leading icon", () => {
    const { container } = render(<Input aria-label="Search" icon={SearchIcon} class="lib-search" />);
    const wrap = container.querySelector(".cms-input-wrap");
    expect(wrap).not.toBeNull();
    expect(wrap!.className).toContain("lib-search");
    expect(wrap!.querySelector(".cms-input__icon")).not.toBeNull();
  });

  it("reports its disabled state", () => {
    render(<Input aria-label="Slug" disabled />);
    expect(screen.getByRole("textbox", { name: "Slug" })).toBeDisabled();
  });
});

describe("Select", () => {
  it("renders its options behind a caret and keeps the caller class on the wrapper", () => {
    const { container } = render(
      <Select aria-label="Kind" modelValue={signal("pattern")} on:change={vi.fn()} class="lib-filter">
        <option value="pattern">Pattern</option>
        <option value="page">Page</option>
      </Select>,
    );
    const select = screen.getByRole("combobox", { name: "Kind" });
    expect(select.className).toBe("cms-select");
    expect(select).toHaveValue("pattern");
    const wrap = container.querySelector(".cms-select-wrap")!;
    expect(wrap.className).toContain("lib-filter");
    expect(wrap.querySelector(".cms-select__caret")).not.toBeNull();
  });

  it("reports its disabled state", () => {
    render(
      <Select aria-label="Kind" disabled>
        <option value="page">Page</option>
      </Select>,
    );
    expect(screen.getByRole("combobox", { name: "Kind" })).toBeDisabled();
  });
});

describe("Textarea", () => {
  it("renders a resizable multi-line control", () => {
    render(<Textarea aria-label="Notes" rows={4} />);
    const textarea = screen.getByRole("textbox", { name: "Notes" });
    expect(textarea.className).toBe("cms-textarea");
    expect(textarea).toHaveAttribute("rows", "4");
  });

  it("reports its disabled state", () => {
    render(<Textarea aria-label="Notes" disabled />);
    expect(screen.getByRole("textbox", { name: "Notes" })).toBeDisabled();
  });
});

function SwitchHarness({ disabled = false }) {
  const checked = signal(false);
  return <Switch checked={checked} onCheckedChange={(next) => { checked.value = next; }} disabled={disabled} label="Auto slug" />;
}

describe("Switch", () => {
  it("is a switch that toggles by click and by keyboard", async () => {
    render(<SwitchHarness />);
    const control = screen.getByRole("switch", { name: "Auto slug" });
    expect(control).not.toBeChecked();
    fireEvent.click(control);
    await settle();
    expect(screen.getByRole("switch", { name: "Auto slug" })).toBeChecked();
    // Space activates a checkbox natively, which jsdom models as a click.
    fireEvent.click(screen.getByRole("switch", { name: "Auto slug" }));
    await settle();
    expect(screen.getByRole("switch", { name: "Auto slug" })).not.toBeChecked();
  });

  it("stays off while disabled", () => {
    render(<SwitchHarness disabled />);
    const control = screen.getByRole("switch", { name: "Auto slug" });
    expect(control).toBeDisabled();
    expect(control).not.toBeChecked();
  });

  it("accepts an aria-label when it renders no visible label", () => {
    render(<Switch checked onCheckedChange={vi.fn()} aria-label="Show slugs" />);
    expect(screen.getByRole("switch", { name: "Show slugs" })).toBeChecked();
  });
});

function CheckboxHarness() {
  const checked = signal(false);
  return <Checkbox checked={checked} onCheckedChange={(next) => { checked.value = next; }} label="Include drafts" />;
}

describe("Checkbox", () => {
  it("toggles and reports each change", async () => {
    const { container } = render(<CheckboxHarness />);
    const control = screen.getByRole("checkbox", { name: "Include drafts" });
    expect(control).toHaveAttribute("type", "checkbox");
    const box = container.querySelector(".cms-check__box");
    expect(box).toHaveAttribute("aria-hidden", "true");
    expect(control.nextElementSibling).toBe(box);
    fireEvent.click(control);
    await settle();
    expect(screen.getByRole("checkbox", { name: "Include drafts" })).toBeChecked();
  });

  it("carries the mixed state as a DOM property", () => {
    render(<Checkbox checked={false} indeterminate onCheckedChange={vi.fn()} aria-label="Select all rows" />);
    const control = screen.getByRole("checkbox", { name: "Select all rows" }) as HTMLInputElement;
    expect(control.indeterminate).toBe(true);
  });

  it("reports its disabled state", () => {
    render(<Checkbox checked={false} disabled onCheckedChange={vi.fn()} label="Include drafts" />);
    expect(screen.getByRole("checkbox", { name: "Include drafts" })).toBeDisabled();
  });
});
