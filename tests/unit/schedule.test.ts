import { describe, expect, test } from "bun:test";
import { addDays } from "~/lib/date";
import { courseStartDate, entriesForDate, unmarkedBefore } from "~/lib/schedule";
import { DEFAULT_SETTINGS, type AttendanceRecord, type Course, type Settings, type Slot } from "~/lib/types";

const TERM = "2026-07-05"; // Sunday
const MON = "2026-07-06";
const TUE = "2026-07-07";

const settings = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, termStart: TERM, ...patch });

function course(id: number, title: string, slots: Slot[], patch: Partial<Course> = {}): Course {
  return { id, title, lecturer: "", color: "#000", slots, threshold: null, createdAt: new Date(2026, 6, 5, 12).getTime(), ...patch };
}

const rec = (courseId: number, date: string, slotId: string, patch: Partial<AttendanceRecord> = {}): AttendanceRecord => ({
  courseId,
  date,
  slotId,
  status: "attended",
  updatedAt: 0,
  ...patch,
});

const cg = course(1, "Computer Graphics", [
  { id: "cg-mon", day: 1, start: "09:40", end: "10:30" },
  { id: "cg-wed-1", day: 3, start: "08:50", end: "09:40" },
  { id: "cg-wed-2", day: 3, start: "09:40", end: "10:30" },
]);
const dip = course(2, "Digital Image Processing", [
  { id: "dip-mon", day: 1, start: "10:30", end: "11:20" },
  { id: "dip-mon-early", day: 1, start: "08:00", end: "08:50" },
]);

describe("entriesForDate", () => {
  test("lists the day's routine classes sorted by start time", () => {
    const e = entriesForDate(MON, [cg, dip], [], settings());
    expect(e.map((x) => x.slotId)).toEqual(["dip-mon-early", "cg-mon", "dip-mon"]);
    expect(e.every((x) => !x.extra && !x.orphan && !x.record)).toBe(true);
  });

  test("same start time sorts by course title", () => {
    const a = course(3, "Zoology", [{ id: "z", day: 1, start: "09:40", end: "10:00" }]);
    const e = entriesForDate(MON, [a, cg], [], settings());
    expect(e.filter((x) => x.start === "09:40").map((x) => x.course.title)).toEqual(["Computer Graphics", "Zoology"]);
  });

  test("attaches existing records", () => {
    const r = rec(1, MON, "cg-mon", { status: "missed" });
    const e = entriesForDate(MON, [cg], [r], settings());
    expect(e).toHaveLength(1);
    expect(e[0].record).toBe(r);
  });

  test("days with no classes are empty", () => {
    expect(entriesForDate(TUE, [cg, dip], [], settings())).toHaveLength(0);
  });

  test("no routine classes before the term starts", () => {
    expect(entriesForDate(addDays(MON, -7), [cg], [], settings())).toHaveLength(0);
    expect(entriesForDate(addDays(MON, -7), [cg], [], settings({ termStart: null }))).toHaveLength(1);
  });

  test("extra classes appear with their own times", () => {
    const x = rec(1, TUE, "extra-abc", { extra: true, start: "14:00", end: "15:00" });
    const e = entriesForDate(TUE, [cg], [x], settings());
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ extra: true, orphan: false, start: "14:00", slotId: "extra-abc" });
  });

  test("records whose slot was removed from the routine show as leftovers", () => {
    const old = rec(1, MON, "deleted-slot", { start: "16:00", end: "17:00" });
    const e = entriesForDate(MON, [cg], [old], settings());
    expect(e.map((x) => [x.slotId, x.orphan])).toEqual([
      ["cg-mon", false],
      ["deleted-slot", true],
    ]);
  });

  test("records of deleted courses are ignored", () => {
    expect(entriesForDate(TUE, [cg], [rec(99, TUE, "whatever")], settings())).toHaveLength(0);
  });

  test("a slot with a start date only appears from that date", () => {
    const c = course(4, "New", [{ id: "n", day: 1, start: "09:00", end: "10:00", from: "2026-08-01" }]);
    expect(entriesForDate("2026-07-27", [c], [], settings())).toHaveLength(0);
    expect(entriesForDate("2026-08-03", [c], [], settings())).toHaveLength(1);
  });
});

describe("courseStartDate", () => {
  test("term start wins; otherwise the day the course was created", () => {
    expect(courseStartDate(cg, settings())).toBe(TERM);
    expect(courseStartDate(cg, settings({ termStart: null }))).toBe("2026-07-05");
  });
});

describe("unmarkedBefore", () => {
  const until = addDays(TERM, 14 * 7); // the Sunday after week 14

  test("14 weeks of routine, nothing marked → 3×14 for CG", () => {
    const list = unmarkedBefore([cg], [], settings(), until);
    expect(list).toHaveLength(42);
    expect(new Set(list.map((e) => e.key)).size).toBe(42);
  });

  test("'until' is exclusive", () => {
    expect(unmarkedBefore([cg], [], settings(), MON)).toHaveLength(0);
    expect(unmarkedBefore([cg], [], settings(), TUE)).toHaveLength(1);
  });

  test("marked classes are left out (any status)", () => {
    const recs = [
      rec(1, MON, "cg-mon"),
      rec(1, "2026-07-08", "cg-wed-1", { status: "missed" }),
      rec(1, "2026-07-08", "cg-wed-2", { status: "cancelled" }),
    ];
    expect(unmarkedBefore([cg], recs, settings(), until)).toHaveLength(39);
  });

  test("newest first, then by start time", () => {
    const list = unmarkedBefore([cg], [], settings(), "2026-07-09");
    expect(list.map((e) => `${e.date} ${e.start}`)).toEqual([
      "2026-07-08 08:50",
      "2026-07-08 09:40",
      "2026-07-06 09:40",
    ]);
  });

  test("courses without slots are skipped", () => {
    expect(unmarkedBefore([course(5, "Empty", [])], [], settings(), until)).toHaveLength(0);
  });

  test("without a term start, counting starts on the day the course was created", () => {
    const late = { ...cg, createdAt: new Date(2026, 7, 2, 12).getTime() }; // Sun 2026-08-02 = week 5
    expect(unmarkedBefore([late], [], settings({ termStart: null }), until)).toHaveLength(3 * 10);
    expect(unmarkedBefore([late], [], settings(), until)).toHaveLength(3 * 14);
  });

  test("slots with a start date are only expected from then", () => {
    const c = course(6, "C", [
      { id: "old", day: 1, start: "09:00", end: "10:00" },
      { id: "new", day: 2, start: "09:00", end: "10:00", from: "2026-08-23" }, // from week 8
    ]);
    const list = unmarkedBefore([c], [], settings(), until);
    expect(list.filter((e) => e.slotId === "old")).toHaveLength(14);
    expect(list.filter((e) => e.slotId === "new")).toHaveLength(7);
  });

  test("looks back at most 200 days", () => {
    const longAgo = settings({ termStart: "2025-01-05" });
    const list = unmarkedBefore([cg], [], longAgo, until);
    const earliest = addDays(until, -200);
    expect(list.every((e) => e.date >= earliest)).toBe(true);
    // 200 days ≈ 28.6 weeks of CG (3/week)
    expect(list.length).toBeGreaterThanOrEqual(84);
    expect(list.length).toBeLessThanOrEqual(87);
  });
});
