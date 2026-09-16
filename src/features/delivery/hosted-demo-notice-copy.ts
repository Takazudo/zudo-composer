/**
 * One source for the hosted-demo wording. The authoring `HostedDemoNotice`
 * banner and the isolated preview strip both read it, so the two cannot drift
 * apart.
 *
 * Split out of `hosted-demo-notice.tsx` (#724): that module also imports the
 * editor's `Banner` from `../../components/ui`, whose barrel carries the
 * general `ui.css` sheet. `PreviewStrip` renders in the visitor document, so
 * importing the constants from here — and not the component module — keeps
 * that editor stylesheet out of its module graph.
 */
export const HOSTED_DEMO_NOTICE_TITLE = "Public demo of zudo-composer";
export const HOSTED_DEMO_NOTICE_COPY = "Edits and uploads stay in this browser tab and reset on reload. Nothing is published. Real authoring runs locally with pnpm dev.";
