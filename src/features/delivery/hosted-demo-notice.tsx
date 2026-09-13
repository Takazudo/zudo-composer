import type { JSX } from "preact";
import { Banner } from "../../components/ui";

export interface HostedDemoNoticeProps {
  /** Keep the project-export reminder on authoring routes only. */
  includeExport?: boolean;
  class?: string;
}

/**
 * Shared copy for the hosted demo. The notice is intentionally not dismissible:
 * a visitor should always be able to tell that this is a disposable demo.
 */
export function HostedDemoNotice({ includeExport = false, class: className }: HostedDemoNoticeProps): JSX.Element {
  return (
    <Banner tone="info" title="Public demo of zudo-composer" class={className}>
      Edits and uploads stay in this browser tab and reset on reload. Nothing is published. Real authoring runs locally with <code>pnpm dev</code>.
      {includeExport ? <> Export JSON to keep your project. Local release operations are unavailable.</> : null}
    </Banner>
  );
}
