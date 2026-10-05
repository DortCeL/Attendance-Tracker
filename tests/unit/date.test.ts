import { describe, expect, test } from "bun:test";
import { addDays, formatTime, orderedWeekdays, parseISODate, toISODate, weekdayOf } from "~/lib/date";

describe("toISODate / parseISODate", () => {
  test("pads month and day", () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  test("parses as local midnight (no UTC shift)", () => {
    const d = parseISODate("2026-07-05");
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 6, 5, 0]);
  });

  test("roundtrips every day of a year", () => {
    let iso = "2026-01-01";
    for (let i = 0; i < 365; i++) {
      expect(toISODate(parseISODate(iso))).toBe(iso);
      iso = addDays(iso, 1);
    }
    expect(iso).toBe("2027-01-01");
  });
});

describe("addDays", () => {
  test.each([
    ["2026-07-31", 1, "2026-08-01"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2027-01-01", -1, "2026-12-31"],
    ["2028-02-28", 1, "2028-02-29"], // leap year
    ["2027-02-28", 1, "2027-03-01"],
    ["2026-07-05", 97, "2026-10-10"], // last day of a 14-week term
    ["2026-07-05", 0, "2026-07-05"],
  ])("%s %+d → %s", (from, n, to) => {
    expect(addDays(from, n)).toBe(to);
  });
});

describe("weekdayOf", () => {
  test("known dates", () => {
    expect(weekdayOf("2026-07-05")).toBe(0); // Sunday
    expect(weekdayOf("2026-10-05")).toBe(1); // Monday
    expect(weekdayOf("2028-02-29")).toBe(2); // Tuesday
  });

  test("advances by one every day for 2 years", () => {
    let iso = "2026-01-01";
    let wd = weekdayOf(iso);
    for (let i = 0; i < 730; i++) {
      iso = addDays(iso, 1);
      wd = ((wd + 1) % 7) as typeof wd;
      expect(weekdayOf(iso)).toBe(wd);
    }
  });
});

describe("orderedWeekdays", () => {
  test("starts on the configured day", () => {
    expect(orderedWeekdays(6)).toEqual([6, 0, 1, 2, 3, 4, 5]);
    expect(orderedWeekdays(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(orderedWeekdays(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});

describe("formatTime", () => {
  test.each([
    ["00:05", "12:05 AM"],
    ["08:00", "8:00 AM"],
    ["11:59", "11:59 AM"],
    ["12:00", "12:00 PM"],
    ["13:30", "1:30 PM"],
    ["23:45", "11:45 PM"],
    ["", ""],
  ])("%s → %s", (input, out) => {
    expect(formatTime(input)).toBe(out);
  });
});
