import type { TrustedComponentPack } from "@zudo-composer/component-contract";

export interface ResolvedComponentPack {
  /** The config `pack` value, verbatim. */
  specifier: string;
  /** Scope + name, without the export subpath. */
  packageName: string;
  /** Directory of the resolved package. */
  packageRoot: string;
  /** Absolute path of the pack module. */
  entryPath: string;
}

export function packageNameOf(specifier: string): string;
export function packageRootAbove(filePath: string): string;
export function resolveComponentPack(workspaceRoot: string, specifier: string): ResolvedComponentPack;
export function assertPackSourcesResolvable(
  workspaceRoot: string,
  manifest: TrustedComponentPack["manifest"],
  specifier: string,
): void;
export function loadComponentPack(
  workspaceRoot: string,
  specifier: string,
  evaluate: (entryPath: string) => Promise<Record<string, unknown>>,
): Promise<{ identity: ResolvedComponentPack; pack: TrustedComponentPack }>;
