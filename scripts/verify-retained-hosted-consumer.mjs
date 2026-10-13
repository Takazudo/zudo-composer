// @ts-check
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The preceding payload check attests the current checkout against this exact
// reachable output commit, including when CI uses a synthetic PR merge SHA.
const inventory = JSON.parse(readFileSync(join(import.meta.dirname, "../verification/hosted-content/current-payload.json"), "utf8"));
assert.match(inventory.packageOutputSha, /^[a-f0-9]{40}$/);
execFileSync(process.execPath, [join(import.meta.dirname, "verify-hosted-consumer.mjs"), inventory.packageOutputSha, process.argv[2] ?? ".artifacts/hosted-consumer"], { stdio: "inherit" });
