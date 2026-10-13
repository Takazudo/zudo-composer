import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { ContentScalarControl } from "../scalar-control";

function typeRaw(input: HTMLInputElement, raw: string, numeric: number) {
  Object.defineProperty(input, "value", { configurable: true, get: () => raw });
  Object.defineProperty(input, "valueAsNumber", { configurable: true, get: () => numeric });
  fireEvent.input(input);
}

describe("local Content number control", () => {
  it("clears only on empty input and passes browser intermediates through unchanged", () => {
    const onChange = vi.fn();
    render(<ContentScalarControl schema={{ kind: "number" }} value={5} label="price" onChange={onChange} />);
    const input = screen.getByRole("spinbutton", { name: "price" }) as HTMLInputElement;
    typeRaw(input, "-", Number.NaN);
    expect(onChange).toHaveBeenLastCalledWith(Number.NaN);
    typeRaw(input, "", Number.NaN);
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    typeRaw(input, "12", 12);
    expect(onChange).toHaveBeenLastCalledWith(12);
  });
});
