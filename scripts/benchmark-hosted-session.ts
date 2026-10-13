import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { createContentEntryRecord, createContentModelRecord } from "../src/content/library/helpers";
import type { HostedContentSession as Session, HostedRecoveryCheckpoint } from "../src/hosted-content/session";
import type { HostedState, HostedTransport } from "../src/hosted-content/types";
const source = process.argv[2] ?? "src/hosted-content/session.ts";
const { HostedContentSession } = await import(pathToFileURL(resolve(source)).href) as { HostedContentSession: typeof Session };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const results = [];
let observed = 0;
for (const entries of [10, 100, 1000]) {
  const stamp = "2026-01-01T00:00:00.000Z";
  const content: HostedState = { draftRevision: "r0", baseline: { gitSha: "g0", contentDigest: "c0" }, definition: "d0", integrationFence: 0,
    providers: [{ providerId: "content", models: [createContentModelRecord({ name: "Article", kind: "collection", fields: [{ id: "body", key: "body", label: "Body", kind: "long-text", required: false }] }, { id: "article", timestamp: stamp })],
      entries: Array.from({ length: entries }, (_, i) => createContentEntryRecord("article", { body: "A paragraph of ordinary content. ".repeat(32) }, { id: `entry-${i}`, timestamp: stamp })) }] };
  const checkpoint: HostedRecoveryCheckpoint = { version: 1, acknowledged: content, edits: [], localRevision: 0, pending: null };
  const cold = [], warm = [], editing = [];
  for (let sample = 0; sample < 5; sample++) {
    const transport: HostedTransport = { readState: async () => clone(content), readReceipt: async () => null, getPublication: async () => { throw new Error("unused"); }, execute: async () => ({ state: clone(content), snapshot: { ...clone(content), id: "snapshot", digest: "digest", assets: [], diagnostics: [], renderData: {} } }) };
    let coldTime = 0;
    for (let i = 0; i < 30; i++) {
      const session = new HostedContentSession({ transport, createOperationKey: () => "cold", recovery: checkpoint });
      const start = performance.now(); observed += session.state.content!.providers[0]!.entries.length; coldTime += performance.now() - start;
    }
    cold.push(coldTime / 30);
    let written = () => {};
    const session = new HostedContentSession({ transport, createOperationKey: () => "snapshot", preview: { render: async () => undefined }, persistRecovery: () => { written(); } });
    await session.initialize(); await session.captureAndPreview("home");
    for (let i = 0; i < 20; i++) observed += session.state.content!.providers[0]!.entries.length;
    const start = performance.now(); for (let i = 0; i < 200; i++) observed += session.state.content!.providers[0]!.entries.length;
    warm.push((performance.now() - start) / 200);
    const editStart = performance.now();
    for (let i = 0; i < 40; i++) {
      const persisted = new Promise<void>((resolve) => { written = resolve; });
      session.edit({ providerId: "content", modelId: "article", recordId: "entry-0" }, "body", `Edit ${i}`);
      await persisted;
    }
    editing.push((performance.now() - editStart) / 40);
    session.dispose();
  }
  results.push({ entries, contentBytes: Buffer.byteLength(JSON.stringify(content)), coldMs: median(cold), warmWithReviewedSnapshotMs: median(warm), editWithCheckpointMs: median(editing), samples: { cold, warm, editing } });
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, source, observed, method: "5 samples, median milliseconds per operation; cold: 30 first getters after detached recovery construction (construction excluded); warm: 200 unchanged getters with full reviewed snapshot after 20 warmups; editing: 40 distinct edits, including emit/projection and awaited no-op checkpoint writer; checkpoint copying remains included. No transport save or durable I/O timing.", results }, null, 2));
