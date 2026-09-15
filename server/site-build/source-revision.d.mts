/** Preserve an explicit host revision, or use nonempty GITHUB_SHA, absent otherwise. */
export function resolveSiteSourceRevision(
  sourceRevision: string | undefined,
  env?: Record<string, string | undefined>,
): string | undefined;
