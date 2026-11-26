import { expect, it, vi } from "vitest";
import { createNativeReloadHold } from "../reload-hold";

it("runs an initiating tab's automatic reopen only after its receipt is settled", () => {
  const gate = createNativeReloadHold();
  const order: string[] = [];
  const release = gate.hold();
  const reopen = () => { order.push("reopen"); return true; };

  gate.afterSettlement(reopen);
  expect(order).toEqual([]);
  order.push("durable receipt");
  expect(release()).toBe(true);
  expect(order).toEqual(["durable receipt", "reopen"]);
});

it("rechecks whether the tab can reopen safely at settlement and leaves unrelated tabs immediate", () => {
  const gate = createNativeReloadHold();
  let clean = true;
  const resume = vi.fn(() => clean);
  gate.afterSettlement(resume);
  expect(resume).toHaveBeenCalledTimes(1);

  const release = gate.hold();
  gate.afterSettlement(resume);
  clean = false;
  expect(release()).toBe(false);
  expect(resume).toHaveBeenCalledTimes(2);
});
