// @ts-check
import assert from "node:assert/strict";
import { relative } from "node:path";
import { discoverConsumerHosts } from "./check-consumer-boundary.mjs";

/** The archive may carry creator templates, but never repository host trees.
 * Discover configured/declared hosts too, even if they have no demo-* name.
 * @param {Iterable<string>} packedPaths @param {string} root */
export function assertPackedConsumerBoundary(packedPaths, root) {
  const hosts = discoverConsumerHosts(root).map((host) => `${relative(root, host).replaceAll("\\", "/")}/`);
  for (const packed of packedPaths) {
    assert.ok(!packed.startsWith("fixtures/"), `packed archive exposes a repository fixture: ${packed}`);
    assert.ok(!hosts.some((host) => packed.startsWith(host)), `packed archive exposes a consumer host: ${packed}`);
  }
}
