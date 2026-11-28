import { getScope, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { isSignal, toSignal, type MaybeSignal } from "../../../../components/reactive";
import { render, settle } from "../../../../test/render";
import type { ComposerReuseResolutionOptions } from "../../../../composer/browser";
import { createComposerIntegration, type ComposerIntegrationApi, type ComposerIntegrationOptions } from "../use-composer-integration";

type Unwrap<T> = T extends ReadonlySignal<infer V> ? V : T;
type View<T> = { [K in keyof T]: K extends "controller" | "exportState" ? View<T[K]> : Unwrap<T[K]> };

/** The integration as the old hook result exposed it: every signal member reads as its value. */
export type IntegrationView = View<ComposerIntegrationApi>;

const views = new WeakMap<object, object>();
const NESTED = new Set<PropertyKey>(["controller", "exportState"]);

function view<T extends object>(target: T): T {
  const cached = views.get(target);
  if (cached) return cached as T;
  const proxy = new Proxy(target, {
    get(object, key) {
      const value = Reflect.get(object, key);
      if (isSignal(value)) return (value as ReadonlySignal<unknown>).value;
      if (NESTED.has(key) && typeof value === "object" && value !== null) return view(value);
      return value;
    },
  });
  views.set(target, proxy);
  return proxy;
}

/** Mounts one integration in an owned root; `reuseResolution` may be a signal to change it later. */
export function renderIntegration(
  options: Omit<ComposerIntegrationOptions, "reuseResolution"> & {
    reuseResolution?: MaybeSignal<ComposerReuseResolutionOptions | undefined>;
  },
) {
  let api: ComposerIntegrationApi | null = null;
  function Host() {
    api = createComposerIntegration(getScope(), {
      ...options,
      reuseResolution: options.reuseResolution === undefined ? undefined : toSignal(options.reuseResolution),
    });
    return null;
  }
  const mounted = render(<Host />);
  return {
    result: { current: view(api!) as unknown as IntegrationView },
    api: api!,
    unmount: () => mounted.unmount(),
  };
}

/** Runs a command; an async one settles scheduled work after it resolves. */
export function act(fn: () => void): void;
export function act(fn: () => Promise<unknown>): Promise<void>;
export function act(fn: () => unknown): void | Promise<void> {
  const result = fn();
  if (result instanceof Promise) return result.then(() => settle());
  return undefined;
}
