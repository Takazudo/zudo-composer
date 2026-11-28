import { expect, it } from "vitest";
import { getScope, signal } from "@takazudo/zfb/zudo-react";
import { render, settle } from "../../test/render";
import { Keyed, nodeRenderKey } from "../keyed";

it("remounts its subtree only when the key changes", async () => {
  const events: string[] = [];
  const node = signal({ id: "hero", revision: 1, heading: "One" });
  function Pack(props: { heading: string }) {
    events.push(`setup ${props.heading}`);
    getScope().onCleanup(() => events.push(`cleanup ${props.heading}`));
    return <h2>{props.heading}</h2>;
  }
  const view = render(
    <Keyed value={node} by={(value) => nodeRenderKey(value.id, value.revision)}>
      {(value) => <Pack heading={value.value.heading} />}
    </Keyed>,
  );
  expect(view.getByRole("heading").textContent).toBe("One");
  node.value = { id: "hero", revision: 2, heading: "Two" };
  await settle();
  expect(view.getByRole("heading").textContent).toBe("Two");
  expect(events).toEqual(["setup One", "setup Two", "cleanup One"]);
  view.unmount();
  expect(events.at(-1)).toBe("cleanup Two");
});

it("builds the remount key from node id and props revision", () => {
  expect(nodeRenderKey("n1", 3)).toBe("n1@3");
  expect(nodeRenderKey("n1", 3)).not.toBe(nodeRenderKey("n1", 4));
});
