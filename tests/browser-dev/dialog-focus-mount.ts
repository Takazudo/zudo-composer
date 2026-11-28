/// <reference types="vite/client" />
import { computed, h, signal, Show, type Child, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { Dialog } from "../../src/components/overlay/dialog";
import { Keyed } from "../../src/runtime/keyed";
import { mountOwnedChild } from "../../src/runtime/root";

export type FocusProbeState = "closed" | "A" | "B" | "route";
type OpenDialog = "A" | "B" | null;

/**
 * Replaces one open dialog with another (remounted by its label) and finally
 * swaps the whole view for a route, so the spec can prove where the dialog
 * stack hands focus back. Served by the app's own Vite graph, so it shares the
 * app's single zudo-react runtime. Returns the state setter.
 */
export function mountDialogFocusProbe(host: HTMLElement): (next: FocusProbeState) => void {
  const state = signal<FocusProbeState>("closed");
  const isRoute = computed(() => state.value === "route");
  const open = computed((): OpenDialog => state.value === "A" || state.value === "B" ? state.value : null);

  const dialog = (label: "A" | "B"): Child => h(
    Dialog,
    { open: true, label, onClose: () => { state.value = "closed"; } },
    h(
      "button",
      { id: `inside-${label}`, "on:click": () => { state.value = label === "A" ? "B" : "closed"; } },
      label === "A" ? "Replace" : "Finish",
    ),
  );

  function Harness(): Child {
    return h(Show, {
      when: isRoute,
      children: () => h("main", { id: "new-route" }, "New route"),
      fallback: () => h(
        "section",
        {},
        h("button", { id: "probe-opener", "on:click": () => { state.value = "A"; } }, "Probe open"),
        h(Keyed<OpenDialog>, {
          value: open,
          by: (label: OpenDialog) => label ?? "closed",
          children: (label: ReadonlySignal<OpenDialog>) => label.value === null ? null : dialog(label.value),
        }),
      ),
    });
  }

  mountOwnedChild(h(Harness, {}), { parent: host, identity: { component: "Harness", build: "composer-browser-probe" } });
  return (next) => { state.value = next; };
}
