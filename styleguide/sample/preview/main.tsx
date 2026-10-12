import { render } from "preact";
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
const root = document.getElementById("sample-preview")!;
let disposed = false;
let story: Story | undefined;
let overrides: Record<string, unknown> = {};
let pendingTheme: "light" | "dark" = matchMedia("(prefers-color-scheme: dark)")
  .matches
  ? "dark"
  : "light";
let frame = 0;

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

function paint() {
  document.documentElement.dataset.theme = pendingTheme;
  document.documentElement.classList.toggle("dark", pendingTheme === "dark");
  document.documentElement.style.colorScheme = pendingTheme;
  if (!story || disposed) return;
  const defaults = Object.fromEntries(
    (story.controls ?? []).map((c) => [c.prop, c.defaultValue]),
  );
  render(
    <div class="p-hsp-md" data-sg-variant-root>
      {story.render({ ...defaults, ...overrides })}
    </div>,
    root,
  );
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
    paint();
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
// Body padding can change its border box without changing the content box.
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
  render(null, root);
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
