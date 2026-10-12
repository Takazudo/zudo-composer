// @ts-check
import assert from "node:assert/strict";

export const exactText = "正確な日本語の追記。\n句読点・空白  も保持します。";
export const tableColumns = ["項目", "値"];
export const tableRows = [["供給された行", "そのまま保持"], ["Second row", "42"]];

/**
 * @param {(args: string[], input: unknown) => Promise<any>} cli
 * @param {{workspaceId: string, assetId: string}} initialized
 */
export async function proveEdits(cli, initialized) {
  const page = { workspaceId: initialized.workspaceId, page: "/" };
  let lastPlan;
  for (const request of [
    { ...page, after: { kind: "paragraph", ordinal: 1 }, insert: { kind: "image", assetId: initialized.assetId, alt: "Native managed image" } },
    { ...page, after: { nodeId: "list" }, insert: { kind: "text", text: exactText } },
    { ...page, after: { nodeId: "table" }, insert: { kind: "table", columns: tableColumns, rows: tableRows } },
  ]) {
    const plan = await cli(["edit", "plan", "--stdin"], request);
    lastPlan = plan;
    assert.equal(plan.request.insert.kind, request.insert.kind);
    const reviewed = await cli(["edit", "review", "--stdin"], { planId: plan.id });
    assert.equal(reviewed.digest, plan.digest);
    assert.deepEqual(reviewed.candidate, plan.candidate);
    // Independently assert the exact insertion against the reviewed before image.
    const before = plan.before.document.root;
    const after = plan.candidate.document.root;
    assert.equal(after.length, before.length + 1);
    const added = after.find(node => node.id === plan.generatedId);
    assert.ok(added);
    assert.deepEqual(after.filter(node => node.id !== plan.generatedId), before);
    if (request.insert.kind === "text") assert.equal(added.props.text, exactText);
    if (request.insert.kind === "table") {
      assert.deepEqual(added.props.columns, tableColumns);
      assert.deepEqual(added.props.rows, tableRows);
    }
    if (request.insert.kind === "image") {
      assert.equal(added.props.alt, "Native managed image");
      assert.match(added.props.src, /^\/uploaded-assets\//);
    }
    const applied = await cli(["edit", "apply", "--stdin"], { planId: plan.id, approve: plan.digest });
    assert.equal(applied.kind, "applied");
    const receipt = await cli(["edit", "receipt", "--stdin"], { planId: plan.id });
    assert.deepEqual(receipt.applied, applied);
    assert.equal(receipt.undone, null);
    // Repeating the exact approved apply is an idempotent receipt lookup.
    assert.deepEqual(await cli(["edit", "apply", "--stdin"], { planId: plan.id, approve: plan.digest }), applied);
    if (request.insert.kind === "table") {
      const undone = await cli(["edit", "undo", "--stdin"], { planId: plan.id, approve: plan.digest });
      assert.equal(undone.kind, "undone");
      const receipts = await cli(["edit", "receipt", "--stdin"], { planId: plan.id });
      assert.deepEqual(receipts.applied, applied);
      assert.deepEqual(receipts.undone, undone);
      const restored = await cli(["edit", "inspect", "--stdin"], page);
      assert.deepEqual(restored.record, plan.before);
      // Restore the intended result with a newly reviewed plan, never reuse or
      // mutate the already approved candidate's generated node identity.
      lastPlan = await cli(["edit", "plan", "--stdin"], request);
      assert.notEqual(lastPlan.id, plan.id);
      assert.notEqual(lastPlan.generatedId, plan.generatedId);
      const replacementReview = await cli(["edit", "review", "--stdin"], { planId: lastPlan.id });
      assert.deepEqual(replacementReview, lastPlan);
      const replacement = await cli(["edit", "apply", "--stdin"], { planId: lastPlan.id, approve: lastPlan.digest });
      assert.equal(replacement.kind, "applied");
    }
  }
  console.log("Installed native edit CLI: managed image, exact Japanese text and supplied table insertions, receipts and guarded undo passed.");
  return lastPlan;
}
