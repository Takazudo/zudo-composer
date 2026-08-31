import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SafeRootFilesystem, type SafeRootErrorPolicy } from "../safe-root";

type TestOperation = "initialize" | "work";

const errors: SafeRootErrorPolicy<TestOperation> = {
  isError: (value) => value instanceof Error,
  create: (_operation, _code, message, cause) => new Error(message, { cause }),
  rethrow: (_operation, _code, message, cause): never => {
    throw new Error(message, { cause });
  },
};

describe("SafeRootFilesystem root serialization", () => {
  const sandboxes: string[] = [];

  afterEach(async () => {
    await Promise.all(sandboxes.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function create(root: string) {
    return SafeRootFilesystem.create({
      root,
      errors,
      rootLabel: "Test root",
      ownerLabel: "Test",
      recordLabel: "record",
      initializeOperation: "initialize",
    });
  }

  it("shares a queue by verified realpath while keeping separate roots independent", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "safe-root-test-"));
    sandboxes.push(sandbox);
    const sharedRoot = join(sandbox, "shared");
    const otherRoot = join(sandbox, "other");
    const first = await create(sharedRoot);
    const sameRoot = await create(sharedRoot);
    const separateRoot = await create(otherRoot);

    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    let sameRootStarted = false;

    const held = first.run("work", async () => {
      markFirstStarted();
      await firstMayFinish;
    });
    await firstStarted;
    const queued = sameRoot.run("work", async () => {
      sameRootStarted = true;
    });

    await expect(separateRoot.run("work", async () => "independent")).resolves.toBe("independent");
    expect(sameRootStarted).toBe(false);

    releaseFirst();
    await Promise.all([held, queued]);
    expect(sameRootStarted).toBe(true);
  });
});
