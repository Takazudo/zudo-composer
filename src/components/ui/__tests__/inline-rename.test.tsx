import { cleanup, fireEvent, render, screen, settle } from "../../../test/render";
import { afterEach, expect, it, vi } from "vitest";
import { InlineRename } from "../inline-rename";

afterEach(cleanup);

it.each(["Enter", "Escape"])("preserves native composition until end, then handles %s", async (key) => {
  const commit = vi.fn(), cancel = vi.fn();
  const { unmount } = render(<InlineRename value="Before" label="Rename" onCommit={commit} onCancel={cancel} />);
  const input = screen.getByRole("textbox");
  fireEvent.input(input, { target: { value: "日本語" } });
  await settle();
  fireEvent(input, new CompositionEvent("compositionstart", { bubbles: true }));
  for (const event of [{ key: "Enter", isComposing: true }, { key: "Escape", keyCode: 229 }, { key: "Enter" }, { key: "Escape" }]) fireEvent.keyDown(input, event);
  expect(commit).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled(); expect(input).toHaveFocus();
  fireEvent(input, new CompositionEvent("compositionend", { bubbles: true }));
  // Key flags still protect the composition-ending engine event.
  fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
  expect(commit).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key });
  if (key === "Enter") { expect(commit).toHaveBeenCalledWith("日本語"); expect(cancel).not.toHaveBeenCalled(); }
  else { expect(cancel).toHaveBeenCalledOnce(); expect(commit).not.toHaveBeenCalled(); }
  const remove = vi.spyOn(input, "removeEventListener");
  unmount();
  expect(remove).toHaveBeenCalledWith("compositionstart", expect.any(Function));
  expect(remove).toHaveBeenCalledWith("compositionend", expect.any(Function));
});
