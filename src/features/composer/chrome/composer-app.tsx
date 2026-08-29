"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The `/composer` entry mounts directly in the standalone host. Integration wires the real surfaces
// in the editor surfaces. Issue #305 now delegates to `ProductionComposerApp`,
// which composes the provider collection, library, hash-route coordinator, and a
// record-scoped `ComposerIntegration`. This entry remains a thin, stable mount
// point so the page document and isolated `/composer/preview` route are
// unchanged.

import type { JSX } from "preact";
import { ProductionComposerApp } from "../app";
import { activeComponentProvider } from "../active-pack";

export default function ComposerApp(): JSX.Element {
  return <ProductionComposerApp componentProvider={activeComponentProvider} />;
}

ComposerApp.displayName = "ComposerApp";
