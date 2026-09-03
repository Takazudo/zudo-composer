/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Banner, Button } from "../../components/ui";
import type { ContentCatalog } from "../../content";
import type { CompositionCatalog, MappingProvider } from "../../mapping";
import type { ComposerComponentProvider } from "../composer/component-provider";
import {
  createMappingEditorController,
  type MappingContentEntryCatalog,
  type MappingEditorController,
  type MappingEditorState,
} from "./controller";
import {
  MAPPING_ROUTE,
  parseMappingDeepLink,
  type MappingDeepLinkState,
  type MappingRouteLocation,
} from "./deep-link";
import { MappingEditor } from "./editor";
import { MappingLibrary } from "./library";

// The Mapping route. `/mapping` is the library and
// `/mapping?provider=&mapping=` is one record, so opening, creating,
// duplicating and deleting are real navigations — a Mapping URL an author
// copies opens the Mapping they were looking at.

export interface MappingRouteContentProps {
  provider: MappingProvider;
  contentCatalog: ContentCatalog;
  compositionCatalog: CompositionCatalog;
  contentEntries: MappingContentEntryCatalog;
  componentProvider: ComposerComponentProvider;
  controller?: MappingEditorController;
  /** Optional route seam for direct-refresh and deep-link tests. */
  location?: MappingRouteLocation;
  /** Route transitions; the browser's own navigation otherwise. */
  navigate?: (href: string) => void;
}

function defaultNavigate(href: string): void {
  window.location.assign(href);
}

export function MappingApp(props: MappingRouteContentProps): JSX.Element {
  const controller = useMemo(
    () => props.controller ?? createMappingEditorController(
      props.provider,
      { content: props.contentCatalog, compositions: props.compositionCatalog },
      props.contentEntries,
      props.componentProvider.catalog,
    ),
    [props.controller, props.provider, props.contentCatalog, props.compositionCatalog, props.contentEntries, props.componentProvider.catalog],
  );
  const [state, setState] = useState<MappingEditorState>(controller.state);
  const [error, setError] = useState<string | null>(null);
  const initializationStarted = useRef(false);
  const navigateRef = useRef(props.navigate);
  navigateRef.current = props.navigate;

  const routePathname = props.location?.pathname ?? (typeof window === "undefined" ? "" : window.location.pathname);
  const routeSearch = props.location?.search ?? (typeof window === "undefined" ? "" : window.location.search);
  const parsedDeepLink = useMemo(() => parseMappingDeepLink({ pathname: routePathname, search: routeSearch }), [routePathname, routeSearch]);

  useEffect(() => controller.subscribe(setState), [controller]);
  useEffect(() => {
    if (initializationStarted.current || controller.state.phase !== "idle") return;
    initializationStarted.current = true;
    const request = parsedDeepLink.status === "requested" ? parsedDeepLink.request : undefined;
    void Promise.resolve().then(() => controller.initialize(request)).then(() => {
      if (parsedDeepLink.status === "invalid") controller.setDeepLinkOutcome(parsedDeepLink);
    }).catch((reason: unknown) => {
      if (parsedDeepLink.status === "requested") {
        const message = reason instanceof Error ? reason.message : "Mapping initialization failed.";
        controller.setDeepLinkOutcome({ status: "provider-failure", request: parsedDeepLink.request, message });
      }
    });
  }, [controller, parsedDeepLink]);

  const run = (action: () => void | Promise<void>) => {
    const fail = (reason: unknown) => setError(reason instanceof Error ? reason.message : "Mapping action failed.");
    setError(null);
    try { void Promise.resolve(action()).catch(fail); } catch (reason) { fail(reason); }
  };
  const navigate = (href: string) => (navigateRef.current ?? defaultNavigate)(href);

  return (
    <div class="cms-mapping-root">
      {state.mapping ? (
        <MappingEditor
          state={state}
          controller={controller}
          componentProvider={props.componentProvider}
          navigate={navigate}
          error={error}
          run={run}
        />
      ) : (
        <MappingLibrary
          state={state}
          controller={controller}
          navigate={navigate}
          notice={<DeepLinkNotice state={state.deepLink ?? { status: "none" }} controller={controller} />}
          error={error}
          run={run}
        />
      )}
    </div>
  );
}

/**
 * A deep link that did not open a record. It is reported HERE, on the library,
 * rather than as a page of its own: the author is already where they need to
 * be to pick another Mapping, and the dismissal takes the dead query string
 * off the URL so a reload does not ask the same failing question again.
 */
function DeepLinkNotice({ state, controller }: { state: MappingDeepLinkState; controller: MappingEditorController }): JSX.Element | null {
  if (state.status === "none" || state.status === "ready" || state.status === "loading") return null;
  const title = state.status === "invalid"
    ? "Invalid Mapping link"
    : state.status === "missing"
      ? "Mapping not found"
      : "Mapping provider unavailable";

  return (
    <Banner
      tone={state.status === "invalid" ? "warn" : "err"}
      title={title}
      action={
        <Button
          size="sm"
          onClick={() => {
            controller.setDeepLinkOutcome({ status: "none" });
            if (typeof window !== "undefined" && window.location.pathname === MAPPING_ROUTE) {
              window.history.replaceState({}, "", MAPPING_ROUTE);
            }
          }}
        >
          Dismiss
        </Button>
      }
    >
      {state.message}
    </Banner>
  );
}
