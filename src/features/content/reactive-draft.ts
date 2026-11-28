import type { ReadonlySignal, Scope } from "@takazudo/zfb/zudo-react";
import { storeSignal } from "../../runtime";
import type { ContentAuthoringController, ContentAuthoringState } from "./controller";

/** The controller's state as a signal owned by `scope`; the subscription lives as long as the scope. */
export function controllerState(scope: Scope, controller: Pick<ContentAuthoringController, "state" | "subscribe">): ReadonlySignal<ContentAuthoringState> {
  return storeSignal(scope, {
    getSnapshot: () => controller.state,
    subscribe: (listener) => controller.subscribe(() => listener()),
  });
}
