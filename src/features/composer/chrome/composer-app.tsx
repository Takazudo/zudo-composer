"use client";

// The `/composer` entry mounts directly in the standalone host and delegates to
// `ProductionComposerApp`, which composes the provider collection, library,
// hash-route coordinator, and a record-scoped `ComposerIntegration`. This entry
// remains a thin, stable mount point so the page document and isolated
// `/composer/preview` route are unchanged.

import type { Child } from "@takazudo/zfb/zudo-react";
import type { CompositionProvider } from "../../../composer/browser";
import type { AppServices } from "../../../app/services";
import { ProductionComposerApp } from "../app";
import type { ComposerComponentProvider } from "../active-pack";

export interface ComposerAppProps {
  /** The shell's route services; the workspace sessions, asset store and chrome store come from here. */
  services?: AppServices;
  componentProvider: ComposerComponentProvider;
  providers: readonly CompositionProvider[];
}

export default function ComposerApp({ services, componentProvider, providers }: ComposerAppProps): Child {
  return <ProductionComposerApp services={services} componentProvider={componentProvider} providers={providers} />;
}

ComposerApp.displayName = "ComposerApp";
