import { For, computed, h, signal } from "@takazudo/zfb/zudo-react";
import { mount, type RootHandle } from "@takazudo/zfb/zudo-react/client";
import { loaders } from "./loaders";
import type { Story, StoryMeta } from "./story-types";
import {
  installIframeReceiver,
  isBridgeMessage,
} from "@takazudo/zudo-sg/token-tweak";
import {
  isRequestReadyMessage,
  isUpdatePropsMessage,
  isSetThemeMessage,
  matchesPreviewIdentity,
  PROTOCOL_VERSION,
  MSG_READY,
  MSG_HEIGHT,
} from "@takazudo/zudo-sg/preview/messages";
import "../src/styles/preview-entry.css";

const params = new URLSearchParams(location.search);
const identity = {
  slug: params.get("slug") ?? "",
  variant: params.get("variant") ?? "",
};
const root = document.getElementById("landing-preview")!;
let disposed = false;
let story: Story | undefined;
let overrides: Record<string, unknown> = {};
let pendingTheme: "light" | "dark" = matchMedia("(prefers-color-scheme: dark)")
  .matches
  ? "dark"
  : "light";
let frame = 0;
let handle: RootHandle | null = null;
const revision = signal(0);
const identityRoot = { component: "LandingPreview", build: "zc-sg-landing-preview" } as const;

function post(type: typeof MSG_READY | typeof MSG_HEIGHT, extra = {}) {
  parent.postMessage(
    { type, v: PROTOCOL_VERSION, ...identity, ...extra },
    location.origin,
  );
}

function reportHeight() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    post(MSG_HEIGHT, {
      height: Math.ceil(document.body.getBoundingClientRect().bottom + scrollY),
    });
  });
}

function applyTheme() {
  document.documentElement.dataset.theme = pendingTheme;
  document.documentElement.classList.toggle("dark", pendingTheme === "dark");
  document.documentElement.style.colorScheme = pendingTheme;
}

// Stories render plain props once, so each props update remounts the variant.
function LandingPreview() {
  return (
    <For each={computed(() => [revision.value])} by={(key) => key}>
      {() => {
        const defaults = Object.fromEntries(
          (story?.controls ?? []).map((c) => [c.prop, c.defaultValue]),
        );
        return (
          <div class="sg-preview-root" data-sg-variant-root>
            {story?.render({ ...defaults, ...overrides })}
          </div>
        );
      }}
    </For>
  );
}
// The minified function name cannot carry the root identity.
LandingPreview.displayName = identityRoot.component;

// zudo-react mounts only into a host carrying its caller-owned root contract.
function mountRoot() {
  root.setAttribute("data-zfb-island-skip-ssr", identityRoot.component);
  root.setAttribute("data-zfb-transport", "json/1");
  root.setAttribute("data-zfb-protocol", "zudo-react/1");
  root.setAttribute("data-zfb-build", identityRoot.build);
  const codes: string[] = [];
  handle = mount(h(LandingPreview, null), root, {
    identity: identityRoot,
    report: (diagnostic) => {
      codes.push(diagnostic.code);
      console.error(diagnostic.code, diagnostic);
    },
  });
  if (!handle) throw Error(`Preview mount refused: ${codes.join(", ")}`);
}

function paint() {
  applyTheme();
  if (!story || disposed) return;
  if (handle) revision.value += 1;
  else mountRoot();
  reportHeight();
}

function receive(event: MessageEvent) {
  if (event.origin !== location.origin || event.source !== parent) return;
  if (event.data?.v !== PROTOCOL_VERSION) return;
  if (!event.data || !matchesPreviewIdentity(event.data, identity)) return;
  if (isRequestReadyMessage(event.data)) {
    if (story) {
      post(MSG_READY);
      reportHeight();
    }
  } else if (isUpdatePropsMessage(event.data)) {
    overrides = { ...event.data.props };
    paint();
  } else if (isSetThemeMessage(event.data)) {
    pendingTheme = event.data.theme;
    applyTheme();
    if (story && !disposed) reportHeight();
  }
}

// The public token receiver validates origin and shape. Add the host's parent
// source boundary before its bubble listener without replacing that API.
function filterTokenSender(event: MessageEvent) {
  if (
    isBridgeMessage(event.data) &&
    (event.origin !== location.origin || event.source !== parent)
  ) {
    event.stopImmediatePropagation();
  }
}

window.addEventListener("message", receive);
window.addEventListener("message", filterTokenSender, true);
const disposeTokens = installIframeReceiver();
const resize = new ResizeObserver(reportHeight);
resize.observe(root);
// Vertical body padding changes its border box without resizing content.
resize.observe(document.body, { box: "border-box" });

function dispose(event: PageTransitionEvent) {
  // BFCache freezes this document; its scope must still work on restoration.
  if (event.persisted) return;
  disposed = true;
  window.removeEventListener("message", receive);
  window.removeEventListener("message", filterTokenSender, true);
  window.removeEventListener("pagehide", dispose);
  resize.disconnect();
  disposeTokens();
  cancelAnimationFrame(frame);
  handle?.unmount();
  handle = null;
}
window.addEventListener("pagehide", dispose);

const load = loaders[identity.slug as keyof typeof loaders];
if (!load) throw Error(`Unknown preview slug: ${identity.slug}`);
const mod = (await load()) as unknown as Record<string, Story | StoryMeta>;
const selected = mod[identity.variant];
if (!selected || !("render" in selected)) {
  throw Error(`Unknown preview variant: ${identity.variant}`);
}
if (!disposed) {
  story = selected;
  paint();
  post(MSG_READY);
}
