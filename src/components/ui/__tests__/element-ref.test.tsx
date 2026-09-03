/**
 * Preact strips `ref` from function components rather than forwarding it, so
 * `Button` and `Input` expose `elementRef`. Menu triggers (`useMenu`) and focus
 * targets depend on it; without it callers hand-roll a raw `<button class="cms-btn">`
 * or wrap in a `<div ref>` and reach in with `querySelector`.
 */
import { render } from "@testing-library/preact";
import { createRef } from "preact";
import { describe, expect, it } from "vitest";
import { Button } from "../button";
import { Input } from "../form-controls";
import { SearchIcon } from "../../icons";

describe("elementRef", () => {
  it("gives Button's caller the rendered button element", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button elementRef={ref}>Open</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current?.classList.contains("cms-btn")).toBe(true);
    expect(ref.current?.textContent).toBe("Open");
  });

  it("gives Input's caller the rendered input element", () => {
    const plain = createRef<HTMLInputElement>();
    render(<Input elementRef={plain} value="a" onInput={() => undefined} />);
    expect(plain.current).toBeInstanceOf(HTMLInputElement);
    expect(plain.current?.classList.contains("cms-input")).toBe(true);
  });

  it("lands on the input and not the wrapper when an icon is present", () => {
    // The icon variant wraps the input in a <span class="cms-input-wrap">, which
    // is where a naive ref would end up — and a wrapper cannot be focused or read
    // for a value, so the workaround this prop replaces would still be needed.
    const withIcon = createRef<HTMLInputElement>();
    render(<Input elementRef={withIcon} icon={SearchIcon} value="a" onInput={() => undefined} />);
    expect(withIcon.current).toBeInstanceOf(HTMLInputElement);
    expect(withIcon.current?.tagName).toBe("INPUT");
    expect(withIcon.current?.classList.contains("cms-input")).toBe(true);
    expect(withIcon.current?.parentElement?.classList.contains("cms-input-wrap")).toBe(true);
  });

  it("supports a callback ref and focusing through it", () => {
    const seen: (HTMLInputElement | null)[] = [];
    render(<Input elementRef={(el) => { seen.push(el); }} value="a" onInput={() => undefined} />);
    const node = seen.find((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    expect(node).toBeInstanceOf(HTMLInputElement);
    node?.focus();
    expect(document.activeElement).toBe(node);
  });
});
