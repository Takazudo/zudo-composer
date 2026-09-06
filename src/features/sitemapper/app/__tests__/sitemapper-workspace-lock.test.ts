import { describe, expect, it } from "vitest";
import { withSitemapperWorkspaceLock } from "../sitemapper-workspace-lock";

describe("Sitemapper workspace lock", () => {
  it("serializes same-workspace fallback mutations", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = withSitemapperWorkspaceLock("workspace", async () => {
      order.push("first-start");
      await gate;
      order.push("first-end");
    });
    const second = withSitemapperWorkspaceLock("workspace", async () => {
      order.push("second");
    });
    await Promise.resolve();
    expect(order).toEqual(["first-start"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });
});
