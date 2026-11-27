import { expect, it } from "vitest";
import { signal } from "@takazudo/zfb/zudo-react";
import { createIslandTest } from "@takazudo/zfb/zudo-react/testing";

it("hydrates and updates", async () => {
  const label = signal("a");
  function Smoke() {
    return <p class="x">{label}</p>;
  }
  const t = createIslandTest(Smoke, {}, { document });
  const p = t.host.querySelector("p");
  expect(t.hydrate()).not.toBeNull();
  label.value = "b";
  await t.flush();
  expect(t.host.querySelector("p")).toBe(p);
  expect(p?.textContent).toBe("b");
  t.dispose();
});
