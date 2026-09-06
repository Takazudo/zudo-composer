import type { ComponentChildren, JSX } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { Dialog } from "../components/overlay";
import { Button, DisclosureButton } from "../components/ui";
import { readPins, writePins, type NavigationModel } from "./navigation-preferences";
import { useWorkspace } from "./workspace-context";
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
import { ChromeContext, createChromeStore, useChrome, type BreadcrumbItem } from "./chrome-context";
import {
  currentRailItem,
  persistRailState,
  Rail,
  railCounts,
  readRailState,
  type RailCounts,
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
    label: "Media",
    href: "/media",
    description: "Browse project media and prepare references for authored content.",
    icon: FolderIcon,
  },
] as const;

export interface ShellProps {
  children: ComponentChildren;
  path: string;
  themeController: ThemeController;
  themeSnapshot: ThemeSnapshot;
  /** Feeds the rail's count slots. Omitted where no provider graph is mounted. */
  summary?: WorkspaceSummary;
}

/**
 * The application chrome: dark rail, breadcrumb topbar, route content.
 *
 * The Shell is the only consumer of `chrome-context`, so it supplies the
 * Provider a route publishes into. `/site*` never reaches here — `App` returns
 * SiteDelivery before the Shell mounts — which is why the rail's Site entry is
 * an external link that can never be the current route.
 */
export function Shell({ children, path, themeController, themeSnapshot, summary }: ShellProps): JSX.Element {
  const workspace = useWorkspace();
  const integration = workspace?.integration;
  const store = useMemo(createChromeStore, []);
  const [railState, setRailState] = useState<RailState>(readRailState);
  const [counts, setCounts] = useState<WorkspaceCounts | null>(null);
  const [models, setModels] = useState<NavigationModel[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  const [pins, setPins] = useState(readPins);
  const [mobile, setMobile] = useState(() => typeof window.matchMedia === "function" && window.matchMedia("(max-width: 760px)").matches);
  const [temporary, setTemporary] = useState(false);
  const [generation, setGeneration] = useState(0);
  const frameRef = useRef<HTMLDivElement>(null);
  const temporaryRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = (restore = true) => { restoreFocusRef.current = restore; setTemporary(false); };
  const open = () => { restoreFocusRef.current = false; triggerRef.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null; setTemporary(true); };

  useEffect(() => integration?.subscribeChanges(() => setGeneration((value) => value + 1)), [integration]);
  useEffect(() => summary?.subscribe?.(() => setGeneration((value) => value + 1)), [summary]);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 760px)");
    const change = () => {
      const active = document.activeElement;
      const restore = temporary || (active instanceof Element && !!active.closest(".cms-rail"));
      setTemporary(false); setMobile(query.matches);
      if (restore) requestAnimationFrame(() => toggleRef.current?.focus());
    };
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, [temporary]);
  useLayoutEffect(() => {
    if (!temporary || !mobile) return;
    const frame = frameRef.current;
    const overflow = document.body.style.overflow;
    frame?.setAttribute("inert", "");
    document.body.style.overflow = "hidden";
    return () => { frame?.removeAttribute("inert"); document.body.style.overflow = overflow; };
  }, [temporary, mobile]);
  useLayoutEffect(() => {
    if (temporary || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    // Dialog's child layout effect has closed the native modal, and the
    // preceding cleanup removed frame inertness. Earlier focus calls are
    // ignored by the browser while the opener is still inert.
    (triggerRef.current?.isConnected ? triggerRef.current : toggleRef.current)?.focus();
  }, [temporary]);
  useEffect(() => {
    if (!temporary || mobile) return;
    closeRef.current?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || temporaryRef.current?.contains(target) || target.closest(".cms-overlay-portal, dialog[open]")) return;
      close(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [temporary, mobile]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (document.querySelector('[role="menu"], dialog[open], [role="dialog"]:not(dialog):not(.cms-navigation-peek)')) return;
      if (event.key === "Escape" && temporary) { event.preventDefault(); close(); return; }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.code === "Backslash" || event.key === "\\")) {
        event.preventDefault(); if (mobile) { if (temporary) close(); else open(); } else if (temporary) close(); else toggleRail();
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  });

  useEffect(() => {
    if (!integration) return;
    let live = true;
    void (async () => {
      const initialized = await integration.initialization.initialize();
      if (initialized.status !== "ready") throw initialized.error;
      const catalog = await integration.contentCatalog.listModels();
      const values = await Promise.allSettled(catalog.entries.map(async (entry) => {
        const result = await integration.contentCatalog.resolveModel(entry.ref);
        if (result.status !== "resolved") throw new Error(`Cannot read model ${entry.summary.name}.`);
        return { providerId: entry.ref.providerId, modelId: entry.ref.recordId, label: result.record.document.name, kind: result.record.document.kind, views: result.record.document.presentation?.views ?? [] };
      }));
      if (live) {
        setModels(values.flatMap((value) => value.status === "fulfilled" ? [value.value] : []));
        setModelError(catalog.failures.length || values.some((value) => value.status === "rejected") ? "Some Content models or providers are unavailable." : null);
      }
    })().catch((cause: unknown) => { if (live) { setModels([]); setModelError(cause instanceof Error ? cause.message : "Content models unavailable."); } });
    return () => { live = false; };
  }, [integration, generation]);

  useEffect(() => {
    if (!summary) return undefined;
    let live = true;
    // `counts()` degrades per source and only rejects when provider
    // initialization itself failed; the rail then shows no counts at all,
    // which is the same "omit rather than invent a zero" answer.
    void summary.counts()
      .then((value) => { if (live) setCounts(value); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [summary, generation]);

  const collapsed = railState === "collapsed";
  const toggleRail = (): void => {
    const next: RailState = collapsed ? "expanded" : "collapsed";
    setRailState(next);
    persistRailState(next);
  };

  const rail: RailCounts = useMemo(() => railCounts(counts), [counts]);
  const railProps = {
    path, counts: rail, models, modelError, pins,
    onPinsChange: (value: typeof pins) => { setPins(value); writePins(value); },
    onToggleCollapsed: toggleRail,
    ...(workspace ? { onNavigate: (href: string) => { void workspace.navigate(href).then((ok) => { if (ok) { close(false); requestAnimationFrame(() => document.getElementById("workspace-destination")?.focus()); } }); } } : {}),
  };
  const temporaryRail = <Rail {...railProps} collapsed={false} hideToggle />;

  return (
    <ChromeContext.Provider value={store}>
      <div class="app-shell" data-rail={railState} data-mobile={mobile}>
        {!mobile && <Rail {...railProps} collapsed={collapsed} onBrowse={open} />}
        <div class="cms-frame" ref={frameRef}>
          <ShellTopbar path={path} themeController={themeController} themeSnapshot={themeSnapshot} navigationControl={<DisclosureButton elementRef={toggleRef} expanded={mobile ? temporary : !collapsed} aria-label={mobile ? "Expand navigation" : collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={mobile ? open : toggleRail} variant="ghost" />} />
          <div class="cms-shell-main" id="workspace-destination" tabIndex={-1}>
            {workspace?.busy && <p role="status" class="cms-shell-notice">Waiting for workspace saves…</p>}
            {workspace?.error && <p role="alert" class="cms-shell-notice">{workspace.error}</p>}
            {children}
          </div>
        </div>
        {!mobile && temporary && <div ref={temporaryRef} class="cms-navigation-peek" role="dialog" aria-label="Browse navigation"><div class="cms-navigation-toolbar"><Button elementRef={closeRef} onClick={() => close()}>Close navigation</Button><Button onClick={() => { setRailState("expanded"); persistRailState("expanded"); close(false); requestAnimationFrame(() => toggleRef.current?.focus()); }}>Keep expanded</Button></div>{temporaryRail}</div>}
        <Dialog open={mobile && temporary} label="Navigation" class="cms-navigation-drawer" initialFocusRef={closeRef} onClose={() => close()} header={<div class="cms-navigation-toolbar"><Button elementRef={closeRef} onClick={() => close()}>Close navigation</Button></div>}>{mobile && temporary ? temporaryRail : null}</Dialog>
      </div>
    </ChromeContext.Provider>
  );
}

/**
 * Split out so `useChrome()` subscribes from inside the Provider: a hook called
 * in `Shell` itself would read the context above it and never see a publish.
 */
function ShellTopbar({
  path,
  themeController,
  themeSnapshot,
  navigationControl,
}: {
  path: string;
  themeController: ThemeController;
  themeSnapshot: ThemeSnapshot;
  navigationControl: ComponentChildren;
}): JSX.Element {
  const chrome = useChrome();
  const item = currentRailItem(path);
  // Every route shows at least where it is; a route that publishes its own
  // trail replaces this default rather than appending to it.
  const fallback: readonly BreadcrumbItem[] = useMemo(
    () => (item ? [{ label: item.label }] : [{ label: "Not found" }]),
    [item],
  );
  const breadcrumb = chrome.breadcrumb.length > 0 ? chrome.breadcrumb : fallback;
  return (
    <Topbar
      breadcrumb={breadcrumb}
      editorStatus={chrome.editorStatus}
      themeController={themeController}
      themeSnapshot={themeSnapshot}
      navigationControl={navigationControl}
    />
  );
}
