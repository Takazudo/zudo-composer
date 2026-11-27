// Stands in for a component pack module: its JSX compiles to the same
// `@takazudo/zfb/zudo-react/jsx-*-runtime` specifiers, resolved from here.
import * as runtime from "@takazudo/zfb/zudo-react";
import { getScope, signal, type ReadonlySignal } from "@takazudo/zfb/zudo-react";

export const packRuntime = runtime;
export const packCount = signal(0);
export const packEvents: string[] = [];

export function PackCard(props: { label: ReadonlySignal<string> }) {
  const scope = getScope();
  packEvents.push("setup");
  scope.onCleanup(() => packEvents.push("cleanup"));
  return <b class="pack-card">{props.label}:{packCount}</b>;
}
