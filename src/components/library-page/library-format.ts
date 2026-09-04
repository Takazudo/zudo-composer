// Timestamp presentation for the library `Updated` column (issue #164).
//
// Kept pure and DOM-free so the branch table is verifiable without rendering:
// the column is the one place in the chrome where a record's age is read at a
// glance, and "3 h ago" vs "Aug 26" is the whole point of the prototype's
// column.

/** Whatever a record's timestamp field holds — epoch ms, an ISO string, a Date. */
export type LibraryTimestamp = string | number | Date;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Parses a record timestamp, returning null for absent or unparseable values. */
export function toLibraryDate(value: LibraryTimestamp | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * "Just now" → "12 min ago" → "3 h ago" → "Yesterday" → "Aug 26" → "Aug 26, 2024".
 *
 * Recent edits read as elapsed time because that is what an author is checking
 * for; anything older reads as a date, and the year only appears once it stops
 * being the current one.
 */
export function formatLibraryTimestamp(value: LibraryTimestamp, now: number = Date.now()): string {
  const date = toLibraryDate(value);
  if (!date) return "";
  const nowDate = new Date(now);
  const elapsed = now - date.getTime();

  // A clock skewed into the future would otherwise report "-3 h ago".
  if (elapsed >= 0) {
    if (elapsed < MINUTE_MS) return "Just now";
    if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min ago`;
    if (isSameDay(date, nowDate)) return `${Math.floor(elapsed / HOUR_MS)} h ago`;
    const yesterday = new Date(startOfDay(nowDate).getTime() - 1);
    if (isSameDay(date, yesterday)) return "Yesterday";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === nowDate.getFullYear() ? undefined : "numeric",
  }).format(date);
}

/** The unabbreviated form, for the cell's `title` and any tooltip surface. */
export function formatLibraryTimestampFull(value: LibraryTimestamp): string {
  const date = toLibraryDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
