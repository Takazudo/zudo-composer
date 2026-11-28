import "../../test-support/cleanup";
import { describe, expect, it, vi } from "vitest";
import { signal } from "@takazudo/zfb/zudo-react";
import { settle } from "../../../../test/render";
import { act, renderIntegration } from "../test-support/integration-harness";
import {
  type ComposerReuseResolutionOptions,
  type GlobalTemplateResolutionOutcome,
} from "../../../../composer/browser";
import { fixtureComponentProvider, makeAbcDocument, resetFixtureIds } from "../../ui/tree/__tests__/fixtures";
import { controllerOptions } from "../test-support/controller-fixtures";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function resolved(cardinality: "single" | "many"): GlobalTemplateResolutionOutcome {
  return {
    status: "resolved",
    binding: { sourceRecordId: "source", outletId: "outlet-main" },
    localRoot: [],
    source: {
      id: "source",
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:00.000Z",
      document: {
        schemaVersion: 2,
        id: "source",
        name: "Source",
        root: [],
        publication: {
          kind: "global-template",
          outlet: {
            id: "outlet-main",
            label: "Main",
            target: { parentId: "owner", slotId: "content" },
          },
        },
      },
    },
    outlet: {
      id: "outlet-main",
      label: "Main",
      target: { parentId: "owner", slotId: "content" },
    },
    rootPolicy: { kind: "resolved", cardinality },
  };
}

describe("createComposerIntegration — provider-scoped reuse resolution", () => {
  it("ignores a late source result after active record navigation", async () => {
    resetFixtureIds();
    const first = deferred<GlobalTemplateResolutionOutcome>();
    const second = deferred<GlobalTemplateResolutionOutcome>();
    const resolver = { resolve: vi.fn() };
    resolver.resolve.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const document = makeAbcDocument();
    document.binding = { sourceRecordId: "source", outletId: "outlet-main" };

    const config = (recordId: string): ComposerReuseResolutionOptions => ({
      ref: { providerId: "files", recordId },
      resolver,
    });
    const reuseResolution = signal<ComposerReuseResolutionOptions | undefined>(config("consumer-a"));
    const { result } = renderIntegration({
      componentProvider: fixtureComponentProvider,
      controllerOptions: controllerOptions(document),
      reuseResolution,
    });

    reuseResolution.value = config("consumer-b");
    await settle();
    await act(async () => {
      second.resolve(resolved("many"));
      await second.promise;
    });
    expect(result.current.reuseResolution).toMatchObject({
      status: "resolved",
      rootPolicy: { cardinality: "many" },
    });
    expect(result.current.controller.state.rootPolicy).toMatchObject({ kind: "resolved", cardinality: "many" });

    await act(async () => {
      first.resolve(resolved("single"));
      await first.promise;
    });
    expect(result.current.reuseResolution).toMatchObject({
      status: "resolved",
      rootPolicy: { cardinality: "many" },
    });
    expect(result.current.controller.state.rootPolicy).toMatchObject({ kind: "resolved", cardinality: "many" });
  });
});
