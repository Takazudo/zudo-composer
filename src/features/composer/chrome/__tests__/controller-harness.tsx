import { getScope, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { render, settle } from "../../../../test/render";
import { createComposerController, type ComposerController, type ComposerControllerOptions } from "../use-composer-controller";

type Unwrapped<T> = { [K in keyof T]: T[K] extends ReadonlySignal<infer V> ? V : T[K] };

/** The controller as the old hook result exposed it: signal members read as their current value. */
export type ControllerView = Unwrapped<ComposerController>;

const SIGNAL_KEYS = new Set<keyof ComposerController>(["state", "lastError", "canUndo", "canRedo"]);

function view(controller: ComposerController): ControllerView {
  return new Proxy(controller, {
    get(target, key) {
      const value = Reflect.get(target, key);
      return SIGNAL_KEYS.has(key as keyof ComposerController) ? (value as ReadonlySignal<unknown>).value : value;
    },
  }) as unknown as ControllerView;
}

/** Mounts one controller in an owned root, so activation and teardown run exactly as in the app. */
export function renderController(options: () => ComposerControllerOptions) {
  let controller: ComposerController | null = null;
  function Host() {
    controller = createComposerController(getScope(), options());
    return null;
  }
  const mounted = render(<Host />);
  const current = view(controller!);
  return {
    result: { current },
    controller: controller!,
    unmount: () => mounted.unmount(),
  };
}

/** Runs a command, then lets scheduled DOM/effect work settle when it returns a promise. */
export function act(fn: () => void): void;
export function act(fn: () => Promise<unknown>): Promise<void>;
export function act(fn: () => unknown): void | Promise<void> {
  const result = fn();
  if (result instanceof Promise) return result.then(() => settle());
  return undefined;
}
