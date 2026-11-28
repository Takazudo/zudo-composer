/**
 * Components take no `ref` of their own, so `Button` and `Input` expose
 * `elementRef`. Menu triggers (`createMenu`) and focus
 * targets depend on it; without it callers hand-roll a raw `<button class="cms-btn">`
 * or wrap in a `<div ref>` and reach in with `querySelector`.
 */
import type { Ref } from "@takazudo/zfb/zudo-react";
import { render, within } from "../../../test/render";
import { describe, expect, it } from "vitest";
import { Button } from "../button";
import { Field } from "../field";
import { Input } from "../form-controls";
import { SearchIcon } from "../../icons";

describe("elementRef", () => {
  it("gives Button's caller the rendered button element", () => {
    const ref = { current: null } as Ref<HTMLButtonElement>;
    render(<Button elementRef={ref}>Open</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current?.classList.contains("cms-btn")).toBe(true);
    expect(ref.current?.textContent).toBe("Open");
  });

  it("gives Input's caller the rendered input element", () => {
    const plain = { current: null } as Ref<HTMLInputElement>;
    render(<Input elementRef={plain} value="a" on:input={() => undefined} />);
    expect(plain.current).toBeInstanceOf(HTMLInputElement);
    expect(plain.current?.classList.contains("cms-input")).toBe(true);
  });

  it("lands on the input and not the wrapper when an icon is present", () => {
    // The icon variant wraps the input in a <span class="cms-input-wrap">, which
    // is where a naive ref would end up — and a wrapper cannot be focused or read
    // for a value, so the workaround this prop replaces would still be needed.
    const withIcon = { current: null } as Ref<HTMLInputElement>;
    render(<Input elementRef={withIcon} icon={SearchIcon} value="a" on:input={() => undefined} />);
    expect(withIcon.current).toBeInstanceOf(HTMLInputElement);
    expect(withIcon.current?.tagName).toBe("INPUT");
    expect(withIcon.current?.classList.contains("cms-input")).toBe(true);
    expect(withIcon.current?.parentElement?.classList.contains("cms-input-wrap")).toBe(true);
  });

  it("supports a callback ref and focusing through it", () => {
    const seen: (HTMLInputElement | null)[] = [];
    render(<Input elementRef={(el) => { seen.push(el); }} value="a" on:input={() => undefined} />);
    const node = seen.find((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    expect(node).toBeInstanceOf(HTMLInputElement);
    node?.focus();
    expect(document.activeElement).toBe(node);
  });
});

describe("Field kind hint", () => {
  it("keeps the kind hint out of the control's accessible name", () => {
    // The hint renders inside the <label>, so without aria-hidden the name
    // computes as "TitleShort text" — accname trims per node, so no separating
    // space survives. Content was the first route to use the slot.
    // Scoped to this render's container, independent of anything else mounted.
    const { container } = render(
      <Field label="Title" kind="Short text">
        {(field) => <Input field={field} value="" on:input={() => undefined} />}
      </Field>,
    );
    expect(within(container as HTMLElement).getByRole("textbox")).toHaveAccessibleName("Title");
  });
});
