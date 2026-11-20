import { AUTHORING_READ_HEADER, retryAuthoringRead } from "../../shared/authoring-read-retry";

/** Reads only browser coordination state; never sends an authoring operation. */
export async function waitForAuthoringSessionReady(
  state: () => { coordinated: boolean; connected: boolean; epoch: number },
  ready: (signal?: AbortSignal) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let requestEpoch = state().epoch;
  const changed = () => Object.assign(new Error("Authoring session changed. Reopen current records."), { code: "stale-browser" });
  await retryAuthoringRead("native-authoring-readiness", { headers: { [AUTHORING_READ_HEADER]: "1" }, signal }, async waitingSignal => {
    const before = state();
    if (before.coordinated && requestEpoch >= 0 && (!before.connected || before.epoch !== requestEpoch)) throw changed();
    await ready(waitingSignal);
    const after = state();
    if (after.coordinated && !after.connected) throw changed();
    if (requestEpoch < 0) requestEpoch = after.epoch;
    if (after.epoch !== requestEpoch) throw changed();
    return new Response(null, { status: 204 });
  });
}
