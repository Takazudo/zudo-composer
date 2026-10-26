// @ts-check

/**
 * Production delivery switch for every hosted-demo target.
 *
 * The production workflow checks out `main` as `trusted-main` and runs the
 * guard from that tree, so changing this value on `main` governs every later
 * run, including runs queued by an older copy of the workflow file. Re-enabling
 * production delivery is a separate, owner-approved change: flip this value,
 * restore the trigger in `.github/workflows/hosted-demo-deploy.yml`, and update
 * `scripts/check-no-deploy.mjs`, whose audit pins the stopped state.
 *
 * @type {"stopped" | "enabled"}
 */
export const PRODUCTION_DELIVERY_STATE = "stopped";

export const PRODUCTION_DELIVERY_STOPPED_MESSAGE =
  "Hosted-demo production delivery is stopped: scripts/hosted-demo/delivery-state.mjs on main is \"stopped\". Builds and artifact verification continue; no Cloudflare deployment runs until production delivery is re-enabled in a separate change.";

/**
 * Throw before any trusted-run lookup, artifact access, credential use or
 * Wrangler call unless production delivery is explicitly enabled.
 *
 * @param {string} [state]
 */
export function assertProductionDeliveryEnabled(state = PRODUCTION_DELIVERY_STATE) {
  if (state !== "enabled") throw new Error(PRODUCTION_DELIVERY_STOPPED_MESSAGE);
}
