/**
 * Tiny className joiner. Accepts strings, falsy values (dropped), and arrays;
 * joins truthy parts with a single space. Last-class-wins is left to the
 * caller's ordering — there is no Tailwind-aware conflict resolution here, so
 * pass overrides last.
 */
export type ClassValue = string | number | false | null | undefined | ClassValue[];

export function cx(...parts: ClassValue[]): string {
  const out: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (Array.isArray(part)) {
      const joined = cx(...part);
      if (joined) out.push(joined);
    } else {
      out.push(String(part));
    }
  }
  return out.join(" ");
}
