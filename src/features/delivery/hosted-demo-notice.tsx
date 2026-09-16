import type { JSX } from "preact";
import { Banner } from "../../components/ui";

export interface HostedDemoNoticeProps {
  /** Keep the project-export reminder on authoring routes only. */
  includeExport?: boolean;
  class?: string;
}

/**
 * One source for the hosted-demo wording. The authoring banner and the
 * isolated preview strip both read it, so the two cannot drift apart.
 */
export const HOSTED_DEMO_NOTICE_TITLE = "Public demo of zudo-composer";
export const HOSTED_DEMO_NOTICE_COPY = "Edits and uploads stay in this browser tab and reset on reload. Nothing is published. Real authoring runs locally with pnpm dev.";

/**
 * Shared copy for the hosted demo. The notice is intentionally not dismissible:
 * a visitor should always be able to tell that this is a disposable demo.
 */
export function HostedDemoNotice({ includeExport = false, class: className }: HostedDemoNoticeProps): JSX.Element {
  return (
    <Banner tone="info" title={HOSTED_DEMO_NOTICE_TITLE} class={className}>
      {HOSTED_DEMO_NOTICE_COPY}
      {includeExport ? <> Export JSON to keep your project. Local release operations are unavailable.</> : null}
    </Banner>
  );
}
