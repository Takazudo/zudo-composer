import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { ProductionProviderIntegration } from "./provider-integration";

/** Shared application lifetime services; feature factories register their save queues here. */
export interface WorkspaceContextValue {
  integration: ProductionProviderIntegration;
  navigate(href: string): Promise<boolean>;
  reset(): Promise<boolean>;
  open(id: string): Promise<boolean>;
  busy: boolean;
  error: string | null;
}
export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
export function useWorkspace(): WorkspaceContextValue | null { return useContext(WorkspaceContext); }
