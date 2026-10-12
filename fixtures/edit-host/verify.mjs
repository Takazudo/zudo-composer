import assert from "node:assert/strict";
import process from "node:process";
import { createEditingService } from "zudo-composer/editing";

const service = await createEditingService({ workspaceRoot: process.cwd() });
const page = await service.inspect({ workspaceId: "native-proof", page: "/" });
assert.deepEqual(page.writeBlockers, []);
assert.equal(page.record.document.root.length, 6);
assert.deepEqual(page.record.document.root.map(node => node.componentId), [
  "native.paragraph", "native.image", "native.list", "native.paragraph", "native.table", "native.table",
]);
const receipt = await service.receipt({ planId: process.argv[2] });
assert.equal(receipt.applied.kind, "applied");
assert.equal(receipt.undone, null);
process.stdout.write("Installed public editing entry: inspect and durable receipt passed.\n");
