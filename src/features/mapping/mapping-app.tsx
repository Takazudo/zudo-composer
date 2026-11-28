import { computed, getScope, signal, type Child, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import type { AppServices } from "../../app/services";
import { Rebuild } from "../../components/rebuild";
import { Banner, Button } from "../../components/ui";
import type { ContentCatalog } from "../../content";
import type { CompositionCatalog, MappingProvider } from "../../mapping";
import { Keyed } from "../../runtime";
import { mappingStateSignal } from "./signals";
import type { ComposerComponentProvider } from "../composer/component-provider";
import {
  createMappingEditorController,
  type MappingContentEntryCatalog,
  type MappingEditorController,
} from "./controller";
import type { MappingAttachmentCallbacks } from "./attachments";
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
  /** The shell's route services; absent when the route is mounted standalone (tests). */
  services?: AppServices;
  provider: MappingProvider;
  contentCatalog: ContentCatalog;
  compositionCatalog: CompositionCatalog;
  contentEntries: MappingContentEntryCatalog;
  componentProvider: ComposerComponentProvider;
  controller?: MappingEditorController;
  /** Aggregate project attachment callbacks supplied by the workspace owner. */
  attachmentCallbacks?: MappingAttachmentCallbacks;
  /** Optional route seam for direct-refresh and deep-link tests. */
  location?: MappingRouteLocation;
  /** Route transitions; the browser's own navigation otherwise. */
  navigate?: (href: string) => void;
}

function defaultNavigate(href: string): void {
  window.location.assign(href);
}


export function MappingApp(props: MappingRouteContentProps): Child {
  const scope = getScope();
  const integration = props.services?.workspace.integration;
  const controller = props.controller ?? createMappingEditorController(
    props.provider,
    { content: props.contentCatalog, compositions: props.compositionCatalog },
    props.contentEntries,
    props.componentProvider.catalog,
    { attachments: props.attachmentCallbacks },
  );
  const state = mappingStateSignal(controller);
  const error = signal<string | null>(null);

  const routePathname = props.location?.pathname ?? (typeof window === "undefined" ? "" : window.location.pathname);
  const routeSearch = props.location?.search ?? (typeof window === "undefined" ? "" : window.location.search);
  const parsedDeepLink = parseMappingDeepLink({ pathname: routePathname, search: routeSearch });

  scope.onActivate(() => {
    if (!integration) return undefined;
    const session = integration.sessions.register({ feature: "Mapping", providerId: props.provider.descriptor.id, workspaceId: integration.workspace.id }, { flush: async () => { await controller.flush(); await props.attachmentCallbacks?.flush?.(); } });
    // Only an accepted draft is a session change. Loading a record or a fresh
    // attachments snapshot is read bookkeeping; reporting it bumped the
    // session generation and sent captures in flight into retry rounds (#994).
    let draft = controller.state.mapping;
    let dirty = controller.state.saveStatus === "dirty";
    const unsubscribe = controller.subscribe((next) => {
      const accepted = next.saveStatus === "dirty" && (next.mapping !== draft || !dirty);
      draft = next.mapping; dirty = next.saveStatus === "dirty";
      if (accepted) session.changed();
    });
    // Persisted changes are caught by capture tokens; they only need a fresh pass.
    const unsubscribeAttachments = props.attachmentCallbacks?.subscribe?.(() => { void controller.attachmentsChanged().catch(() => undefined); });
    return () => { unsubscribe(); unsubscribeAttachments?.(); session.detach(); };
  });
  scope.onActivate(() => {
    if (controller.state.phase !== "idle") return;
    const request = parsedDeepLink.status === "requested" ? parsedDeepLink.request : undefined;
    void Promise.resolve().then(() => controller.initialize(request)).then(() => {
      if (parsedDeepLink.status === "invalid") controller.setDeepLinkOutcome(parsedDeepLink);
    }).catch((reason: unknown) => {
      if (parsedDeepLink.status === "requested") {
        const message = reason instanceof Error ? reason.message : "Mapping initialization failed.";
        controller.setDeepLinkOutcome({ status: "provider-failure", request: parsedDeepLink.request, message });
      }
    });
  });

  const run = (action: () => void | Promise<void>) => {
    const fail = (reason: unknown) => { error.value = reason instanceof Error ? reason.message : "Mapping action failed."; };
    error.value = null;
    try { void Promise.resolve(action()).catch(fail); } catch (reason) { fail(reason); }
  };
  const navigate = (href: string) => (props.navigate ?? defaultNavigate)(href);
  // One editor per open record: a different record id is a fresh editor, an
  // edit to the open record keeps the same one (and its focus) mounted.
  const openRecord = computed(() => state.value.mapping?.id ?? null);

  return (
    <div class="cms-mapping-root">
      <Keyed value={openRecord} by={(id) => id ?? ""}>
        {(id) => id.value !== null ? (
          <MappingEditor
            state={state}
            controller={controller}
            componentProvider={props.componentProvider}
            navigate={navigate}
            error={error}
            run={run}
            services={props.services}
          />
        ) : (
          <MappingLibrary
            state={state}
            controller={controller}
            navigate={navigate}
            notice={<DeepLinkNotice state={computed(() => state.value.deepLink ?? { status: "none" })} controller={controller} />}
            error={error}
            run={run}
            services={props.services}
          />
        )}
      </Keyed>
    </div>
  );
}

/**
 * A deep link that did not open a record. It is reported HERE, on the library,
 * rather than as a page of its own: the author is already where they need to
 * be to pick another Mapping, and the dismissal takes the dead query string
 * off the URL so a reload does not ask the same failing question again.
 */
function DeepLinkNotice({ state, controller }: { state: ReadonlySignal<MappingDeepLinkState>; controller: MappingEditorController }): Child {
  return <Rebuild value={state}>{(current) => {
    if (current.status === "none" || current.status === "ready" || current.status === "loading") return null;
    const title = current.status === "invalid"
      ? "Invalid Mapping link"
      : current.status === "missing"
        ? "Mapping not found"
        : "Mapping provider unavailable";
    return (
      <Banner
        tone={current.status === "invalid" ? "warn" : "err"}
        title={title}
        action={
          <Button
            size="sm"
            on:click={() => {
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
        {current.message}
      </Banner>
    );
  }}</Rebuild>;
}
