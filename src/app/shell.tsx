import { CONTENT_FILE_PROVIDER_DOMAIN } from "../content/storage/file-provider";
import { computed, getScope, Show, signal, type Child, type Ref } from "@takazudo/zfb/zudo-react";
import { Dialog } from "../components/overlay";
import { Button, DisclosureButton } from "../components/ui";
import { readPins, writePins, type NavigationModel, type NavigationPin } from "./navigation-preferences";
import type { WorkspaceServices } from "./services";
import { read, toSignal, type MaybeSignal } from "../components/reactive";
import {
  ComposerIcon,
  ContentIcon,
  FolderIcon,
  HomeIcon,
  MappingIcon,
  SitemapperIcon,
  type IconComponent,
} from "../components/icons";
import type { ThemeController, ThemeSnapshot } from "../theme/theme";
import { chromeSnapshot, createChromeStore, type BreadcrumbItem, type ChromeStore } from "./chrome-context";
import {
  currentRailItem,
  persistRailState,
  Rail,
  railCounts,
  readRailState,
  type RailItem,
  type RailState,
} from "./rail";
import { Topbar } from "./topbar";
import type { WorkspaceCounts, WorkspaceSummary } from "./workspace-summary";
import "./shell.css";

export interface AppRoute {
  readonly label: string;
  readonly href: string;
  readonly description: string;
  readonly icon: IconComponent;
}

/**
 * The card vocabulary the provisional Home route still renders. The rail owns
 * navigation now (`rail.tsx`); this list survives only until the Dashboard task
 * replaces Home, and nothing else should grow a dependency on it.
 */
export const APP_ROUTES: readonly AppRoute[] = [
  {
    label: "Home",
    href: "/",
    description: "See the authoring workspaces and choose where to start.",
    icon: HomeIcon,
  },
  {
    label: "Composer",
    href: "/composer",
    description: "Build reusable page structures from components.",
    icon: ComposerIcon,
  },
  {
    label: "Content",
    href: "/content",
    description: "Define content models and author the Entries they hold.",
    icon: ContentIcon,
  },
  {
    label: "Mapping",
    href: "/mapping",
    description: "Connect Content fields to Composition slots.",
    icon: MappingIcon,
  },
  {
    label: "Sitemapper",
    href: "/sitemapper",
    description: "Organize Compositions into navigable site routes.",
    icon: SitemapperIcon,
  },
  {
    label: "Assets",
    href: "/assets",
    description: "Browse project assets and prepare references for authored content.",
    icon: FolderIcon,
  },
] as const;

export interface ShellProps {
  hostedDemo?: boolean;
  children: Child;
  path: MaybeSignal<string>;
  themeController: ThemeController;
  themeSnapshot: MaybeSignal<ThemeSnapshot>;
  /** Feeds the rail's count slots. Omitted where no provider graph is mounted. */
  summary?: MaybeSignal<WorkspaceSummary | undefined>;
  /** Forwarded to the rail's `newTab` items; see `Rail`'s prop of the same name. */
  onBeforeNewTab?: (item: RailItem) => void;
  /**
   * The mounted workspace: its integration feeds the rail's model tree, its
   * `navigate` takes rail clicks, and its `busy`/`error` show as notices.
   * Omit for a shell without a provider graph (rail links then stay native).
   */
  workspace?: MaybeSignal<WorkspaceServices | null>;
  /** The store routes publish breadcrumb and save state into; the Shell renders it. */
  chrome?: ChromeStore;
}

/**
 * The application chrome: dark rail, breadcrumb topbar, route content.
 *
 * The Shell is the only reader of the chrome store a route publishes into;
 * `App` creates that store and hands the same instance to routes as
 * `services.chrome`. `/site*` never reaches here — it is a separate visitor
 * document — which is why the rail's Site entry opens its own tab and can never
 * be the current route.
 */
export function Shell({ children, path, themeController, themeSnapshot, summary, hostedDemo = false, onBeforeNewTab, workspace, chrome }: ShellProps): Child {
  const scope = getScope();
  const workspaceValue = toSignal(workspace ?? null);
  const integration = computed(() => workspaceValue.value?.integration);
  const summaryValue = toSignal(summary);
  const store = chrome ?? createChromeStore();
  const railState = signal<RailState>(readRailState());
  const counts = signal<WorkspaceCounts | null>(null);
  const models = signal<NavigationModel[]>([]);
  let modelLoading = false;
  const modelError = signal<string | null>(null);
  const pins = signal(readPins());
  const mobile = signal(typeof window.matchMedia === "function" && window.matchMedia("(max-width: 760px)").matches);
  const temporary = signal(false);
  const generation = signal(0);
  const modelGeneration = signal(0);
  const frameRef: Ref<HTMLDivElement> = { current: null };
  const temporaryRef: Ref<HTMLDivElement> = { current: null };
  const toggleRef: Ref<HTMLButtonElement> = { current: null };
  let trigger: HTMLElement | null = null;
  let restoreFocus = false;
  const closeRef: Ref<HTMLButtonElement> = { current: null };
  const close = (restore = true) => { restoreFocus = restore; temporary.value = false; };
  const open = () => { restoreFocus = false; trigger = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null; temporary.value = true; };
  const collapsed = computed(() => railState.value === "collapsed");

  scope.effect(() => integration.value?.subscribeChanges(() => { modelGeneration.value += 1; }, [CONTENT_FILE_PROVIDER_DOMAIN]));
  scope.effect(() => summaryValue.value?.subscribe?.(() => { generation.value += 1; }));
  scope.onActivate(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia("(max-width: 760px)");
    const change = () => {
      const active = document.activeElement;
      const restore = temporary.value || (active instanceof Element && !!active.closest(".cms-rail"));
      temporary.value = false; mobile.value = query.matches;
      if (restore) requestAnimationFrame(() => toggleRef.current?.focus());
    };
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  });
  // Frame inertness, then focus restore, in one effect: the previous run's
  // cleanup lifts inertness before this run hands focus back, and the drawer's
  // native modal has already closed in the commit that removed its panel. The
  // browser ignores a focus call on an opener that is still inert.
  scope.effect(() => {
    const isTemporary = temporary.value;
    const isMobile = mobile.value;
    if (isTemporary && isMobile) {
      const frame = frameRef.current;
      const overflow = document.body.style.overflow;
      frame?.setAttribute("inert", "");
      document.body.style.overflow = "hidden";
      return () => { frame?.removeAttribute("inert"); document.body.style.overflow = overflow; };
    }
    if (!isTemporary && restoreFocus) {
      restoreFocus = false;
      (trigger?.isConnected ? trigger : toggleRef.current)?.focus();
    }
    return undefined;
  });
  scope.effect(() => {
    if (!temporary.value || mobile.value) return undefined;
    closeRef.current?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || temporaryRef.current?.contains(target) || target.closest(".cms-overlay-portal, dialog[open]")) return;
      close(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  });
  scope.onActivate(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (document.querySelector('[role="menu"], dialog[open], [role="dialog"]:not(dialog):not(.cms-navigation-peek)')) return;
      if (event.key === "Escape" && temporary.value) { event.preventDefault(); close(); return; }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.code === "Backslash" || event.key === "\\")) {
        event.preventDefault(); if (mobile.value) { if (temporary.value) close(); else open(); } else if (temporary.value) close(); else toggleRail();
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  });

  scope.onActivate(() => {
    const resumed = () => { if (modelError.value && !modelLoading) modelGeneration.value += 1; };
    window.addEventListener("native-authoring-resumed", resumed);
    return () => window.removeEventListener("native-authoring-resumed", resumed);
  });

  scope.effect(() => {
    const source = integration.value;
    void modelGeneration.value;
    if (!source) return undefined;
    let live = true;
    modelLoading = true;
    void (async () => {
      const initialized = await source.initialization.initialize();
      if (initialized.status !== "ready") throw initialized.error;
      // One read-all instead of list-models plus one get-model per model.
      const readAll = source.contentProvider?.store.readAll;
      // A snapshot refused for one bad record falls through to the per-model path,
      // which still lists every readable model.
      const snapshot = readAll ? await readAll.call(source.contentProvider.store).catch(() => null) : null;
      if (snapshot) {
        const providerId = source.contentProvider.descriptor.id;
        if (live) { models.value = snapshot.models.map((model) => ({ providerId, modelId: model.id, label: model.document.name, kind: model.document.kind, views: model.document.presentation?.views ?? [] })); modelError.value = null; }
        return;
      }
      const catalog = await source.contentCatalog.listModels();
      const values = await Promise.allSettled(catalog.entries.map(async (entry) => {
        const result = await source.contentCatalog.resolveModel(entry.ref);
        if (result.status !== "resolved") throw new Error(`Cannot read model ${entry.summary.name}.`);
        return { providerId: entry.ref.providerId, modelId: entry.ref.recordId, label: result.record.document.name, kind: result.record.document.kind, views: result.record.document.presentation?.views ?? [] };
      }));
      if (live) {
        models.value = values.flatMap((value) => value.status === "fulfilled" ? [value.value] : []);
        modelError.value = catalog.failures.length || values.some((value) => value.status === "rejected") ? "Some Content models or providers are unavailable." : null;
      }
    })().catch((cause: unknown) => { if (live) { models.value = []; modelError.value = cause instanceof Error ? cause.message : "Content models unavailable."; } }).finally(() => { if (live) modelLoading = false; });
    return () => { live = false; };
  });

  scope.effect(() => {
    const source = summaryValue.value;
    void generation.value;
    if (!source) return undefined;
    let live = true;
    // `counts()` degrades per source and only rejects when provider
    // initialization itself failed; the rail then shows no counts at all,
    // which is the same "omit rather than invent a zero" answer.
    void source.counts()
      .then((value) => { if (live) counts.value = value; })
      .catch(() => undefined);
    return () => { live = false; };
  });

  const toggleRail = (): void => {
    const next: RailState = collapsed.value ? "expanded" : "collapsed";
    railState.value = next;
    persistRailState(next);
  };

  const rail = computed(() => railCounts(counts.value));
  const railProps = { hostedDemo,
    path, counts: rail, models, modelError, pins,
    onPinsChange: (value: NavigationPin[]) => { pins.value = value; writePins(value); },
    onToggleCollapsed: toggleRail,
    onBeforeNewTab,
    ...(workspace !== undefined ? { onNavigate: (href: string, source?: Element | null) => {
      const services = read(workspace);
      if (!services) return;
      void services.navigate(href, source).then((ok) => { if (ok) { close(false); requestAnimationFrame(() => document.getElementById("workspace-destination")?.focus()); } });
    } } : {}),
  };
  const temporaryRail = () => <Rail {...railProps} collapsed={false} hideToggle />;
  const desktop = computed(() => !mobile.value);
  const peekOpen = computed(() => !mobile.value && temporary.value);
  const busy = computed(() => workspaceValue.value?.busy.value ?? false);
  const error = computed(() => workspaceValue.value?.error.value ?? null);

  return (
    <div class="app-shell" data-rail={railState} data-mobile={computed(() => String(mobile.value))}>
      <Show when={desktop}>{() => <Rail {...railProps} collapsed={collapsed} onBrowse={open} />}</Show>
      <div class="cms-frame" ref={frameRef}>
        <ShellTopbar path={path} store={store} themeController={themeController} themeSnapshot={themeSnapshot} navigationControl={<DisclosureButton elementRef={toggleRef} expanded={computed(() => (mobile.value ? temporary.value : !collapsed.value))} aria-label={computed(() => (mobile.value ? "Expand navigation" : collapsed.value ? "Expand sidebar" : "Collapse sidebar"))} on:click={() => { if (mobile.value) open(); else toggleRail(); }} variant="ghost" />} />
        <div class="cms-shell-main" id="workspace-destination" tabindex={-1}>
          <Show when={busy}>{() => <p role="status" class="cms-shell-notice">Waiting for workspace saves…</p>}</Show>
          <Show when={computed(() => error.value !== null && error.value !== "")}>{() => <p role="alert" class="cms-shell-notice">{error}</p>}</Show>
          {children}
        </div>
      </div>
      <Show when={peekOpen}>{() => <div ref={temporaryRef} class="cms-navigation-peek" role="dialog" aria-label="Browse navigation"><div class="cms-navigation-toolbar"><Button elementRef={closeRef} on:click={() => close()}>Close navigation</Button><Button on:click={() => { railState.value = "expanded"; persistRailState("expanded"); close(false); requestAnimationFrame(() => toggleRef.current?.focus()); }}>Keep expanded</Button></div>{temporaryRail()}</div>}</Show>
      <Dialog open={computed(() => mobile.value && temporary.value)} label="Navigation" class="cms-navigation-drawer" initialFocusRef={closeRef} onClose={() => close()} header={<div class="cms-navigation-toolbar"><Button elementRef={closeRef} on:click={() => close()}>Close navigation</Button></div>}>{temporaryRail()}</Dialog>
    </div>
  );
}

function ShellTopbar({
  path,
  store,
  themeController,
  themeSnapshot,
  navigationControl,
}: {
  path: MaybeSignal<string>;
  store: ChromeStore;
  themeController: ThemeController;
  themeSnapshot: MaybeSignal<ThemeSnapshot>;
  navigationControl: Child;
}): Child {
  const chrome = chromeSnapshot(getScope(), store);
  // Every route shows at least where it is; a route that publishes its own
  // trail replaces this default rather than appending to it.
  const breadcrumb = computed<readonly BreadcrumbItem[]>(() => {
    const published = chrome.value.breadcrumb;
    if (published.length > 0) return published;
    const item = currentRailItem(read(path));
    return item ? [{ label: item.label }] : [{ label: "Not found" }];
  });
  return (
    <Topbar
      breadcrumb={breadcrumb}
      editorStatus={computed(() => chrome.value.editorStatus)}
      themeController={themeController}
      themeSnapshot={themeSnapshot}
      navigationControl={navigationControl}
    />
  );
}
