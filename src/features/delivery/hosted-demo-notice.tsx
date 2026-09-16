import type { JSX } from "preact";
import { Banner } from "../../components/ui";
import { HOSTED_DEMO_NOTICE_COPY, HOSTED_DEMO_NOTICE_TITLE } from "./hosted-demo-notice-copy";

export interface HostedDemoNoticeProps {
  /** Keep the project-export reminder on authoring routes only. */
  includeExport?: boolean;
  class?: string;
}

export { HOSTED_DEMO_NOTICE_COPY, HOSTED_DEMO_NOTICE_TITLE };

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
