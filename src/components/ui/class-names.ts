import type { HTMLAttributes } from "@takazudo/zfb/zudo-react";

/** Joins class-name parts, dropping the falsy branches conditional classes produce. */
export function cx(...parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * zudo-react types intrinsic `class` as a value or a signal. These controls
 * compose their class from several parts, so they narrow the prop back to a
 * plain string.
 */
export type WithPlainClass<Props> = Omit<Props, "class"> & { class?: string };

/** Native attributes of an intrinsic element, minus the reserved `ref`. */
export type NativeProps<T extends HTMLElement> = WithPlainClass<Omit<HTMLAttributes<T>, "ref">>;
