"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The `/composer` client island entry — the component `pages/composer/index.tsx`
// mounts directly in the standalone host. Wave-5 integration wired the real surfaces
// in the editor surfaces. Issue #305 now delegates to `ProductionComposerApp`,
// which composes the provider registry, library, hash-route coordinator, and a
// record-scoped `ComposerIntegration`. This entry remains a thin, stable mount
// point so the page document and isolated `/composer/preview` route are
// unchanged.

import type { JSX } from "preact";
import { ProductionComposerApp } from "../app";
import { activeComponentManifest } from "../active-pack";

export default function ComposerApp(): JSX.Element {
  return <ProductionComposerApp manifest={activeComponentManifest} />;
}

ComposerApp.displayName = "ComposerApp";
