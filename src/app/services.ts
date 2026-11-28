import type { ReadonlySignal } from "@takazudo/zfb/zudo-react";
import type { ChromeStore } from "./chrome-context";
import type { PageLoading } from "./page-loading/page-loading";
import type { ProductionProviderIntegration } from "./provider-integration";

// The application services a route receives explicitly, as its `services`
// prop. There is no context: `App` builds one `AppServices` per mounted
// workspace (route content is remounted when the workspace or route epoch
// changes), so a route reads `services.workspace.integration` once in setup.

/** Shared workspace lifetime services; feature factories register their save queues on `integration.sessions`. */
export interface WorkspaceServices {
  /** The provider graph of the workspace this route was mounted for. */
  readonly integration: ProductionProviderIntegration;
  /** `source` is the clicked control; it carries the pending-navigation marker until the swap. */
  navigate(href: string, source?: Element | null): Promise<boolean>;
  reset(): Promise<boolean>;
  open(id: string): Promise<boolean>;
  /** True while a navigation or workspace replacement waits on the save barrier. */
  readonly busy: ReadonlySignal<boolean>;
  readonly error: ReadonlySignal<string | null>;
}

/** Everything the shell hands a route. */
export interface AppServices {
  readonly workspace: WorkspaceServices;
  /** Publish breadcrumb and save state with `bindBreadcrumb` / `bindEditorStatus`. */
  readonly chrome: ChromeStore;
  /** Hold the page-loading scrim with `holdPageLoadingWhile`. */
  readonly pageLoading: PageLoading;
}

/** The prop every routed feature entry component takes. */
export interface RouteServicesProps {
  services: AppServices;
}
