import { describe, expect, it } from "vitest";
import { formatLibraryTimestamp, formatLibraryTimestampFull, toLibraryDate } from "../library-format";

// Local constructors throughout: the calendar-day branches read local time, so
// a UTC literal would make these assertions timezone-dependent.
const NOW = new Date(2026, 8, 3, 14, 0, 0).getTime();

function at(year: number, month: number, day: number, hour = 12, minute = 0): Date {
  return new Date(year, month, day, hour, minute, 0);
}

describe("toLibraryDate", () => {
  it("accepts the shapes a record's timestamp field takes", () => {
    const date = at(2026, 7, 26);
    expect(toLibraryDate(date)).toBe(date);
    expect(toLibraryDate(date.getTime())?.getTime()).toBe(date.getTime());
    expect(toLibraryDate(date.toISOString())?.getTime()).toBe(date.getTime());
  });

  it("reports an absent or unparseable timestamp as null rather than an Invalid Date", () => {
    expect(toLibraryDate(null)).toBeNull();
    expect(toLibraryDate(undefined)).toBeNull();
    expect(toLibraryDate("not a date")).toBeNull();
  });
});

describe("formatLibraryTimestamp", () => {
  it("reads recent edits as elapsed time", () => {
    expect(formatLibraryTimestamp(NOW - 30_000, NOW)).toBe("Just now");
    expect(formatLibraryTimestamp(NOW - 12 * 60_000, NOW)).toBe("12 min ago");
    expect(formatLibraryTimestamp(NOW - 3 * 3_600_000, NOW)).toBe("3 h ago");
  });

  it("names the previous calendar day instead of counting hours across midnight", () => {
    expect(formatLibraryTimestamp(at(2026, 8, 2, 20, 0), NOW)).toBe("Yesterday");
  });

  it("falls to a date once the record is older than yesterday", () => {
    const date = at(2026, 7, 26, 9, 41);
    expect(formatLibraryTimestamp(date, NOW)).toBe(
      new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date),
    );
  });

  it("adds the year only once it is no longer the current one", () => {
    const date = at(2024, 7, 26, 9, 41);
    expect(formatLibraryTimestamp(date, NOW)).toBe(
      new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date),
    );
  });

  it("never reports a negative age from a clock skewed into the future", () => {
    const ahead = at(2026, 8, 4, 9, 0);
    expect(formatLibraryTimestamp(ahead, NOW)).toBe(
      new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(ahead),
    );
  });

  it("renders nothing for an unparseable timestamp", () => {
    expect(formatLibraryTimestamp("not a date", NOW)).toBe("");
    expect(formatLibraryTimestampFull("not a date")).toBe("");
  });

  it("keeps the unabbreviated form for the cell title", () => {
    const date = at(2026, 8, 3, 9, 0);
    expect(formatLibraryTimestampFull(date)).toBe(
      new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date),
    );
  });
});
