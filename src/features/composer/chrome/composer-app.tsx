"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The `/composer` entry mounts directly in the standalone host and delegates to
// `ProductionComposerApp`, which composes the provider collection, library,
// hash-route coordinator, and a record-scoped `ComposerIntegration`. This entry
// remains a thin, stable mount point so the page document and isolated
// `/composer/preview` route are unchanged.

import type { JSX } from "preact";
import type { CompositionProvider } from "../../../composer/browser";
import { ProductionComposerApp } from "../app";
import type { ComposerComponentProvider } from "../active-pack";

export interface ComposerAppProps {
  componentProvider: ComposerComponentProvider;
  providers: readonly CompositionProvider[];
}

export default function ComposerApp({ componentProvider, providers }: ComposerAppProps): JSX.Element {
  return <ProductionComposerApp componentProvider={componentProvider} providers={providers} />;
}

ComposerApp.displayName = "ComposerApp";
