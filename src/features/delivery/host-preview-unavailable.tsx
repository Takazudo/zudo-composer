import type { Child } from "@takazudo/zfb/zudo-react";
import { savedHostPreviewHref } from "./host-preview-policy";
/** Never imports the component pack or substitutes live state for an immutable release. */
export function HostPreviewBoundary({ kind }: { kind: "working" | "activated" }): Child {
  return <main><h1>{kind === "activated" ? "Activated release preview unavailable" : "Use the saved host page preview"}</h1>
    {kind === "activated" ? <><p>This host renders complete documents. An exact activated-release preview is not supported here. The current workspace is not this immutable release.</p><p>Use the host's verified exact-snapshot static build to inspect release output.</p><a href="/review">Review &amp; release</a></> : <><p>The saved host page preview uses this host's production renderer. Save or discard pending edits before opening it; it captures the current saved workspace.</p><a href={savedHostPreviewHref}>Open saved host page preview</a></>}
  </main>;
}
