import { afterEach, describe, expect, it, vi } from "vitest";
import { createBulkRecordCache } from "../bulk-record-cache";
import { notifyPersistenceChange } from "../../shared/persistence-generation";

describe("bulk record cache", () => {
  afterEach(() => { vi.useRealTimers(); });
  it("serves many per-record reads from one bulk read and re-reads after a change or the TTL", async () => {
    vi.useFakeTimers();
    const read = vi.fn(async () => [{ id: "a", v: 1 }, { id: "b", v: 2 }]);
    const lookup = createBulkRecordCache(read, (record) => record.id, 1000);
    expect(await Promise.all(["a", "b", "a", "missing"].map(lookup))).toEqual([{ id: "a", v: 1 }, { id: "b", v: 2 }, { id: "a", v: 1 }, undefined]);
    expect(read).toHaveBeenCalledTimes(1);
    notifyPersistenceChange("mapping"); await lookup("a"); expect(read).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1001); await lookup("a"); expect(read).toHaveBeenCalledTimes(3);
  });
  it("falls back (undefined) when the bulk read fails, and retries it next time", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue([{ id: "a" }]);
    const lookup = createBulkRecordCache(read, (record: { id: string }) => record.id);
    expect(await lookup("a")).toBeUndefined();
    expect(await lookup("a")).toEqual({ id: "a" }); expect(read).toHaveBeenCalledTimes(2);
  });
});
