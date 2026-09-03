import "./cleanup";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { SaveIcon } from "../../icons";
import { Banner } from "../banner";
import { Button } from "../button";

describe("Banner", () => {
  it("announces info and warnings politely", () => {
    const { container } = render(
      <Banner title="Loading compositions…">Skeleton rows replace the plain loading line.</Banner>,
    );
    const banner = screen.getByRole("status");
    expect(banner.className).toBe("cms-banner cms-banner--info");
    expect(banner).toHaveTextContent("Loading compositions…");
    expect(container.querySelector(".cms-banner__icon")).not.toBeNull();
  });

  it("announces errors assertively", () => {
    render(<Banner tone="err" title="Composition library unavailable." />);
    const banner = screen.getByRole("alert");
    expect(banner.className).toBe("cms-banner cms-banner--err");
  });

  it("carries the warn tone", () => {
    render(<Banner tone="warn" title="Stored compositions need recovery." />);
    expect(screen.getByRole("status").className).toBe("cms-banner cms-banner--warn");
  });

  it("renders the action slot", () => {
    const onRetry = vi.fn();
    render(
      <Banner tone="err" title="Composition library unavailable." action={<Button size="sm" onClick={onRetry}>Retry</Button>}>
        IndexedDB could not be opened in this browser session.
      </Banner>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("accepts an icon override", () => {
    const { container } = render(<Banner icon={SaveIcon} title="Saved to browser storage." />);
    expect(container.querySelectorAll(".cms-banner__icon")).toHaveLength(1);
  });
});
