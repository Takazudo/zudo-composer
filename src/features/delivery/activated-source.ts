import { deliverySource as injectedDeliverySource } from "virtual:site-project-source";
import { parseActivatedDeliverySource, type DeliverySourceContract, type ActivatedDeliverySource } from "./source";

let current: ActivatedDeliverySource = injectedDeliverySource;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };

if (import.meta.hot) {
  import.meta.hot.accept("virtual:site-project-source", (module) => {
    if (module?.deliverySource) current = module.deliverySource;
    emit();
  });
  import.meta.hot.on("release:changed", (message) => {
    if (message?.source !== "activated-release") return;
    const next = parseActivatedDeliverySource(message.deliverySource);
    if (!next) return;
    current = next;
    emit();
  });
}

export function activatedDeliverySource(componentProvider: typeof import("../composer/active-pack").activeComponentProvider): Extract<DeliverySourceContract, { kind: "activated" }> {
  return { kind: "activated", componentProvider, read: () => current, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}
