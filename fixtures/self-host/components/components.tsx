import { getScope } from "@takazudo/zfb/zudo-react";

export interface BannerProps {
  headline: string;
}

export function Banner({ headline }: BannerProps) {
  // A second zudo-react copy has no current scope here (ZR_NO_SCOPE), so this
  // host pack fails loudly unless it shares the tool's one runtime.
  getScope();
  return <h1 class="self-host-banner">{headline}</h1>;
}
