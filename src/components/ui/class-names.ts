/** Joins class-name parts, dropping the falsy branches conditional classes produce. */
export function cx(...parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Preact types intrinsic `class` as `Signalish<string | undefined>` so a signal
 * can drive it. These controls compose their class from several parts, so they
 * narrow the prop back to a plain string.
 */
export type WithPlainClass<Props> = Omit<Props, "class"> & { class?: string };
