/**
 * The Dashboard route (issue #173) — the Home route's whole surface.
 *
 * The stylesheet is imported by `dashboard.tsx` rather than from
 * `src/style.css`, so the page and its CSS ship as one unit; the read model it
 * renders lives in `src/app/workspace-summary.ts`.
 */
export { Dashboard } from "./dashboard";
export type { DashboardProps } from "./dashboard";
