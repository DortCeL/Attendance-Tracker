import { beforeAll, describe, expect, test } from "bun:test";
import { bulkSetAttendance, db, exportData, getSettings, importData, resetAll } from "~/database/db";
import { addDays } from "~/lib/date";
import { entriesForDate, unmarkedBefore } from "~/lib/schedule";
import { riskMessage, statsByCourse } from "~/lib/stats";
import type { AttendanceStatus, Weekday } from "~/lib/types";
import { expectConsistent } from "./helpers/invariants";
import { printReport } from "./helpers/report";
import { SAMPLE_ROUTINE, TERM_START, WEEKS, alternatingLabCancelled, pick } from "./helpers/routine";
import { runSemester, slotIdFor, type ClassContext, type SimResult } from "./helpers/simulator";

/** Date of a weekday in a given (1-based) week of the term. */
const dateOf = (week: number, weekday: Weekday) => addDays(TERM_START, (week - 1) * 7 + weekday);

const THEORY = ["CSE 4203", "CSE 4227", "CSE 4263", "CSE 4267"];
const CLASSES_PER_WEEK: Record<string, number> = Object.fromEntries(
  SAMPLE_ROUTINE.map((c) => [c.code, c.slots.length]),
);

function stat(r: SimResult, code: string) {
  const s = r.final.get(code);
  if (!s) throw new Error(`No stats for ${code}`);
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Realistic semester on the sample routine (threshold 60%)", () => {
  const MIDTERM_WEEK = 7;
  const SICK_WEEK = 10;
  const HOLIDAYS = [dateOf(5, 3), dateOf(9, 2)]; // Wed 2026-08-05, Tue 2026-09-01
  const LIKELIHOOD: Record<string, number> = {
    "CSE 4203": 0.93,
    "CSE 4204": 0.95,
    "CSE 4227": 0.85,
    "CSE 4228": 1,
    "CSE 4263": 0.72,
    "CSE 4264": 0.9,
    "CSE 4267": 0.55,
  };
  let r: SimResult;

  beforeAll(async () => {
    r = await runSemester({
      name: "Realistic semester — the routine from public/routine.jpg",
      summary:
        "Random but seeded: per-course habits, 4% surprise cancellations, alternating B1/B2 labs, " +
        "2 public holidays, midterm week 7, sick week 10, 2 makeup classes.",
      courses: SAMPLE_ROUTINE,
      termStart: TERM_START,
      weeks: WEEKS,
      seed: 2026,
      settings: { threshold: 60, warnMargin: 5 },
      holidays: HOLIDAYS,
      cancelledWeeks: [MIDTERM_WEEK],
      extras: [
        { code: "CSE 4227", date: dateOf(8, 4), start: "10:30", end: "11:20", status: "attended" },
        { code: "CSE 4267", date: dateOf(11, 4), start: "11:20", end: "12:10", status: "missed" },
      ],
      decide: ({ code, week, rng }) => {
        if (alternatingLabCancelled(code, week)) return "cancelled";
        if (THEORY.includes(code) && rng() < 0.04) return "cancelled";
        if (week === SICK_WEEK) return "missed";
        return rng() < LIKELIHOOD[code] ? "attended" : "missed";
      },
    });
    printReport(r);
  });

  test("app stats match an independent tally and satisfy every invariant", async () => {
    await expectConsistent(r);
  });

  test("every one of the 210 routine classes (15/week × 14) plus 2 makeups got a record", async () => {
    expect(r.scheduledClasses).toBe(15 * WEEKS);
    expect(await db.records.count()).toBe(15 * WEEKS + 2);
    expect(r.backlog).toHaveLength(0);
    const total = [...r.final.values()].reduce((n, s) => n + s.attended + s.missed + s.cancelled, 0);
    expect(total).toBe(15 * WEEKS + 2);
  });

  test("alternating labs: each lab runs only on its own weeks", () => {
    // CSE 4204 runs on odd weeks: 1,3,5,7,9,11,13 — minus midterm week 7 and the Tue 09-01 holiday (week 9).
    expect(stat(r, "CSE 4204").held).toBe(5);
    expect(stat(r, "CSE 4204").cancelled).toBe(9);
    // CSE 4228 runs on even weeks: 2,4,...,14 — the Wed holiday doesn't touch Tuesday labs.
    expect(stat(r, "CSE 4228").held).toBe(7);
    expect(stat(r, "CSE 4228").cancelled).toBe(7);
  });

  test("midterm week changes nobody's percentage", () => {
    const before = r.weekly[MIDTERM_WEEK - 2].stats;
    const during = r.weekly[MIDTERM_WEEK - 1].stats;
    for (const [code, s] of during) {
      expect(s.held).toBe(before.get(code)!.held);
      expect(s.percent).toBe(before.get(code)!.percent);
      expect(s.cancelled).toBe(before.get(code)!.cancelled + CLASSES_PER_WEEK[code]);
    }
  });

  test("sick week drags every course down and the app warns about it", () => {
    const before = r.weekly[SICK_WEEK - 2].stats;
    const after = r.weekly[SICK_WEEK - 1].stats;
    for (const [code, s] of after) {
      if (s.held > before.get(code)!.held) expect(s.percent!).toBeLessThan(before.get(code)!.percent!);
    }
    expect(r.alerts.some((a) => a.week === SICK_WEEK)).toBe(true);
  });

  test("makeup classes are stored as extras and counted on top of the routine", async () => {
    expect(await db.records.filter((x) => !!x.extra).count()).toBe(2);
    const routineHeld = (code: string) =>
      r.marks.filter((m) => m.code === code && m.status !== "cancelled").length;
    expect(stat(r, "CSE 4227").held).toBe(routineHeld("CSE 4227") + 1);
    expect(stat(r, "CSE 4267").held).toBe(routineHeld("CSE 4267") + 1);
  });

  test("the course you skip most ends up flagged, the one you never skip doesn't", () => {
    const cloud = stat(r, "CSE 4267");
    expect(cloud.risk === "danger" || cloud.risk === "warning").toBe(true);
    expect(r.alerts.some((a) => a.code === "CSE 4267")).toBe(true);
    // CSE 4228 is always attended except the sick week, which fell on one of its (even) lab weeks
    expect(stat(r, "CSE 4228").missed).toBe(1);
    expect(stat(r, "CSE 4228").risk).toBe("safe");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Perfect attendance (threshold 75%)", () => {
  let r: SimResult;
  beforeAll(async () => {
    r = await runSemester({
      name: "Perfect attendance",
      summary: "Attends every class that is held. Labs still alternate.",
      courses: SAMPLE_ROUTINE,
      termStart: TERM_START,
      weeks: WEEKS,
      decide: ({ code, week }) => (alternatingLabCancelled(code, week) ? "cancelled" : "attended"),
    });
    printReport(r);
  });

  test("consistent", async () => {
    await expectConsistent(r);
  });

  test("everything is 100% and safe, with no warnings", () => {
    for (const s of r.final.values()) {
      expect(s.percent).toBe(100);
      expect(s.risk).toBe("safe");
      expect(s.missed).toBe(0);
    }
    expect(r.alerts).toHaveLength(0);
  });

  test("skip budget is exact: 42 attended at 75% → can miss 14 (42/56 = 75%)", () => {
    const s = stat(r, "CSE 4203");
    expect(s.attended).toBe(42);
    expect(s.canSkip).toBe(14);
    expect(riskMessage(s)).toBe("You can miss 14 more classes");
    // 7 attended lab sessions → floor(7/0.75 - 7) = 2
    expect(stat(r, "CSE 4228").canSkip).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Never shows up (threshold 75%, notifications on)", () => {
  let r: SimResult;
  beforeAll(async () => {
    r = await runSemester({
      name: "Never shows up",
      summary: "Misses every class that is held. Notifications enabled.",
      courses: pick(["CSE 4203", "CSE 4264"]),
      termStart: TERM_START,
      weeks: WEEKS,
      settings: { notifications: true },
      decide: () => "missed",
    });
    printReport(r);
  });

  test("consistent", async () => {
    await expectConsistent(r);
  });

  test("0% and in danger from the very first class", () => {
    for (const s of r.final.values()) {
      expect(s.percent).toBe(0);
      expect(s.risk).toBe("danger");
    }
    expect(r.marks.every((m) => m.after.risk === "danger")).toBe(true);
  });

  test("recovery needs 3× the classes held (75% from 0)", () => {
    expect(stat(r, "CSE 4203").needToAttend).toBe(42 * 3);
    expect(stat(r, "CSE 4264").needToAttend).toBe(14 * 3);
    expect(riskMessage(stat(r, "CSE 4264"))).toBe("Attend the next 42 classes to recover");
  });

  test("every single miss raises a danger alert with a system notification", () => {
    expect(r.alerts).toHaveLength(42 + 14);
    expect(r.alerts.every((a) => a.alert.tone === "danger" && a.alert.notify)).toBe(true);
    expect(r.alerts[0].alert.body).toBe("Now at 0.0%. Attend the next 3 classes to recover.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Sliding toward 60% then recovering — the warning has to come before the drop", () => {
  // CSE 4203 has 3 classes a week. Weeks 1–4 attend (12/12), weeks 5–9 miss (15 misses), weeks 10–14 attend.
  let r: SimResult;
  beforeAll(async () => {
    r = await runSemester({
      name: "Sliding toward 60%, then recovering",
      summary: "One course. Attend weeks 1–4, skip weeks 5–9, attend weeks 10–14.",
      courses: pick(["CSE 4203"]),
      termStart: TERM_START,
      weeks: WEEKS,
      settings: { threshold: 60, warnMargin: 5, notifications: true },
      decide: ({ week }) => (week >= 5 && week <= 9 ? "missed" : "attended"),
    });
    printReport(r);
  });

  test("consistent", async () => {
    await expectConsistent(r);
  });

  test("risk goes safe → warning → danger in order, never jumping straight to danger", () => {
    const risks = r.marks.map((m) => m.after.risk);
    const firstWarning = risks.indexOf("warning");
    const firstDanger = risks.indexOf("danger");
    expect(firstWarning).toBeGreaterThan(-1);
    expect(firstDanger).toBeGreaterThan(firstWarning);
    expect(risks.slice(0, firstWarning).every((x) => x === "safe")).toBe(true);
    expect(risks.slice(firstWarning, firstDanger).every((x) => x === "warning")).toBe(true);
  });

  test("exact timeline: 7th miss (12/19 = 63.2%) warns, 9th miss (12/21 = 57.1%) is danger", () => {
    const misses = r.marks.filter((m) => m.status === "missed");
    const risks = misses.map((m) => m.after.risk);
    expect(risks.slice(0, 6)).toEqual(["safe", "safe", "safe", "safe", "safe", "safe"]); // 92% → 66.7%
    expect(misses[6].after.percent!).toBeCloseTo(63.16, 2);
    expect(risks[6]).toBe("warning"); // inside the 5-point margin
    expect(misses[7].after.percent).toBe(60);
    expect(risks[7]).toBe("warning"); // exactly at threshold, can't skip any more
    expect(misses[7].after.canSkip).toBe(0);
    expect(risks[8]).toBe("danger");
    expect(misses[8].after.percent!).toBeCloseTo(57.14, 2);
  });

  test("the first warning the student sees comes while still at or above 60%", () => {
    const first = r.alerts[0];
    expect(first.alert.tone).toBe("warning");
    expect(first.alert.title).toBe("Computer Graphics is getting close to 60%");
    expect(first.alert.body).toBe("Now at 63.2%. You can only miss 1 more.");
    expect(r.alerts[1].alert.body).toBe("Now at 60.0%. Missing one more class drops you below the threshold.");
    expect(r.alerts[2].alert.tone).toBe("danger");
    expect(r.alerts[2].alert.title).toBe("Computer Graphics is below 60%");
  });

  test("lowest point: 12/27 = 44.4%, needs exactly 11 classes in a row to recover", () => {
    const lowest = r.weekly[8].stats.get("CSE 4203")!;
    expect(lowest.attended).toBe(12);
    expect(lowest.held).toBe(27);
    expect(lowest.needToAttend).toBe(11);
  });

  test("while recovering, 'classes to attend' counts down by one per class and danger ends exactly at 0", () => {
    const recovery = r.marks.filter((m) => m.week >= 10);
    let expected = 11;
    for (const m of recovery) {
      expect(m.before.needToAttend).toBe(expected);
      expected = Math.max(0, expected - 1);
      expect(m.after.needToAttend).toBe(expected);
      expect(m.after.risk === "danger").toBe(expected > 0);
    }
    // 23/38 = 60.5% after the 11th class
    expect(recovery[10].after.percent!).toBeCloseTo(60.53, 2);
  });

  test("ends at 27/42 = 64.3%: above the line but still a close call", () => {
    const s = stat(r, "CSE 4203");
    expect(s.attended).toBe(27);
    expect(s.held).toBe(42);
    expect(s.risk).toBe("warning");
    expect(s.canSkip).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Strategic skipper — skips whenever the app says it's safe (threshold 75%)", () => {
  let r: SimResult;
  beforeAll(async () => {
    r = await runSemester({
      name: "Strategic skipper",
      summary: "Skips a class whenever the app says 'You can miss N more' with N > 0.",
      courses: pick(THEORY),
      termStart: TERM_START,
      weeks: WEEKS,
      decide: ({ stats }) => (stats.canSkip > 0 ? "missed" : "attended"),
    });
    printReport(r);
  });

  test("consistent", async () => {
    await expectConsistent(r);
  });

  test("trusting the skip counter never drops a course below the threshold", () => {
    expect(r.marks.some((m) => m.after.risk === "danger")).toBe(false);
    expect(r.alerts.some((a) => a.alert.tone === "danger")).toBe(false);
  });

  test("and squeezes the most out of it: ends right at the line", () => {
    for (const s of r.final.values()) {
      expect(s.percent!).toBeGreaterThanOrEqual(75);
      expect(s.percent!).toBeLessThan(80);
      expect(s.canSkip).toBeLessThanOrEqual(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("A teacher who never shows up", () => {
  let r: SimResult;
  beforeAll(async () => {
    r = await runSemester({
      name: "Teacher never shows up",
      summary: "CSE 4267 is cancelled every single time; CSE 4203 runs normally.",
      courses: pick(["CSE 4203", "CSE 4267"]),
      termStart: TERM_START,
      weeks: WEEKS,
      decide: ({ code }) => (code === "CSE 4267" ? "cancelled" : "attended"),
    });
    printReport(r);
  });

  test("consistent", async () => {
    await expectConsistent(r);
  });

  test("a course with only cancellations has no percentage and no risk", () => {
    const s = stat(r, "CSE 4267");
    expect(s.cancelled).toBe(42);
    expect(s.held).toBe(0);
    expect(s.percent).toBeNull();
    expect(s.risk).toBe("none");
    expect(riskMessage(s)).toBe("No classes recorded yet");
    expect(r.alerts).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Per-course threshold override", () => {
  // Same 70% habit in two courses; global 60%, but CSE 4227 requires 80%.
  let r: SimResult;
  beforeAll(async () => {
    const counter = new Map<string, number>();
    r = await runSemester({
      name: "Per-course threshold",
      summary: "Global 60%. CSE 4227 overrides to 80%. Both courses attended exactly 7 of every 10 classes.",
      courses: [
        pick(["CSE 4203"])[0],
        { ...pick(["CSE 4227"])[0], threshold: 80 },
      ],
      termStart: TERM_START,
      weeks: WEEKS,
      settings: { threshold: 60 },
      decide: ({ code }) => {
        const n = counter.get(code) ?? 0;
        counter.set(code, n + 1);
        return [2, 5, 8].includes(n % 10) ? "missed" : "attended";
      },
    });
    printReport(r);
  });

  test("consistent", async () => {
    await expectConsistent(r);
  });

  test("identical attendance, different verdicts", () => {
    const cg = stat(r, "CSE 4203");
    const dip = stat(r, "CSE 4227");
    expect(cg.percent).toBe(dip.percent);
    expect(cg.threshold).toBe(60);
    expect(dip.threshold).toBe(80);
    expect(cg.risk).toBe("safe");
    expect(dip.risk).toBe("danger");
    // CSE 4203 only ever gets early "can't skip yet" nudges, never a danger alert
    expect(r.alerts.filter((a) => a.code === "CSE 4203").every((a) => a.alert.tone === "warning")).toBe(true);
    expect(r.alerts.filter((a) => a.code === "CSE 4227").every((a) => a.alert.tone === "danger")).toBe(true);
    expect(r.alerts.some((a) => a.alert.title === "Digital Image Processing is below 80%")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Forgetting to mark, then catching up from the backlog", () => {
  let r: SimResult;
  beforeAll(async () => {
    r = await runSemester({
      name: "Forgets to mark ~12% of classes",
      summary: "Every class has a 12% chance of never being marked. Attends the rest.",
      courses: SAMPLE_ROUTINE,
      termStart: TERM_START,
      weeks: WEEKS,
      seed: 7,
      decide: ({ code, week, rng }) => {
        if (rng() < 0.12) return null;
        return alternatingLabCancelled(code, week) ? "cancelled" : "attended";
      },
    });
    printReport(r);
  });

  test("consistent (backlog equals exactly the forgotten classes)", async () => {
    expect(r.forgotten.length).toBeGreaterThan(10);
    await expectConsistent(r);
  });

  test("unmarked classes don't count as held, missed or cancelled", () => {
    const counted = [...r.final.values()].reduce((n, s) => n + s.held + s.cancelled, 0);
    expect(counted + r.forgotten.length).toBe(r.scheduledClasses);
  });

  test("backlog is newest first", () => {
    const dates = r.backlog.map((e) => e.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  test("'mark all attended' on the backlog clears it and adds them to attendance", async () => {
    const before = statsByCourse(r.courses, await db.records.toArray(), r.settings);
    const attendedBefore = [...before.values()].reduce((n, s) => n + s.attended, 0);

    await bulkSetAttendance(
      r.backlog.map((e) => ({ courseId: e.course.id!, date: e.date, slotId: e.slotId, start: e.start, end: e.end })),
      "attended",
    );

    const records = await db.records.toArray();
    expect(unmarkedBefore(r.courses, records, r.settings, addDays(r.endDate, 1))).toHaveLength(0);
    const after = statsByCourse(r.courses, records, r.settings);
    const attendedAfter = [...after.values()].reduce((n, s) => n + s.attended, 0);
    expect(attendedAfter - attendedBefore).toBe(r.backlog.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Adding a course late in the term", () => {
  const late = { ...pick(["CSE 4263"])[0], addedOnWeek: 5 };
  const early = pick(["CSE 4203"])[0];
  const forgetWeeks56 = ({ code, week }: ClassContext): AttendanceStatus | null =>
    code === "CSE 4263" && (week === 5 || week === 6) ? null : "attended";

  test("without a term start, the backlog starts from the day the course was added", async () => {
    const r = await runSemester({
      name: "Late add, no term start",
      summary: "CSE 4263 added in week 5; its week 5–6 classes were never marked.",
      courses: [early, late],
      termStart: TERM_START,
      weeks: WEEKS,
      useTermStart: false,
      decide: forgetWeeks56,
    });
    printReport(r);
    await expectConsistent(r);

    expect(r.backlog).toHaveLength(6);
    expect(r.backlog.every((e) => e.course.code === "CSE 4263" && e.date >= dateOf(5, 0))).toBe(true);
    expect(stat(r, "CSE 4263").held).toBe(3 * (WEEKS - 4) - 6);
    expect(stat(r, "CSE 4203").held).toBe(3 * WEEKS);
  });

  test("with a term start, classes before the course was added also show up as unmarked", async () => {
    const r = await runSemester({
      name: "Late add, term start set",
      summary: "Same, but settings has a term start, so weeks 1–4 count as expected too.",
      courses: [early, late],
      termStart: TERM_START,
      weeks: WEEKS,
      decide: forgetWeeks56,
    });
    await expectConsistent(r, { backlog: false });
    const fromTermStart = unmarkedBefore(r.courses, await db.records.toArray(), r.settings, addDays(r.endDate, 1));
    expect(fromTermStart).toHaveLength(12 + 6);
    expect(fromTermStart.filter((e) => e.date < dateOf(5, 0))).toHaveLength(12);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Changing your mind: corrections and un-marking", () => {
  let r: SimResult;
  beforeAll(async () => {
    r = await runSemester({
      name: "Corrections",
      summary:
        "Marks every class missed, then the same evening fixes Mondays to attended; " +
        "every Wednesday of week 3 gets un-marked; week 12 Tuesday flips missed → cancelled.",
      courses: pick(THEORY),
      termStart: TERM_START,
      weeks: WEEKS,
      decide: () => "missed",
      afterDay: async (date, week, api) => {
        const courses = await db.courses.toArray();
        const recs = await db.records.where("date").equals(date).toArray();
        for (const rec of recs) {
          const code = courses.find((c) => c.id === rec.courseId)!.code!;
          if (date === dateOf(week, 1)) await api.mark(code, date, rec.slotId, "attended");
          if (week === 3 && date === dateOf(3, 3)) await api.mark(code, date, rec.slotId, null);
          if (week === 12 && date === dateOf(12, 2)) await api.mark(code, date, rec.slotId, "cancelled");
        }
      },
    });
    printReport(r);
  });

  test("consistent — corrections update the record instead of adding one", async () => {
    await expectConsistent(r);
  });

  test("Monday fixes turned into attendance", () => {
    // CSE 4203 has 1 Monday class/week; CSE 4263 has 2 Monday classes/week.
    expect(stat(r, "CSE 4203").attended).toBe(WEEKS);
    expect(stat(r, "CSE 4263").attended).toBe(2 * WEEKS);
    expect(stat(r, "CSE 4267").attended).toBe(0);
  });

  test("un-marked classes go back to the backlog", () => {
    // Week 3 Wednesday: CSE 4203 ×2, CSE 4227 ×1, CSE 4267 ×1
    expect(r.backlog).toHaveLength(4);
    expect(r.backlog.every((e) => e.date === dateOf(3, 3))).toBe(true);
  });

  test("missed → cancelled removes the class from the percentage", () => {
    // Week 12 Tuesday: CSE 4227 ×1, CSE 4263 ×1, CSE 4267 ×2
    expect(stat(r, "CSE 4267").cancelled).toBe(2);
    expect(stat(r, "CSE 4227").cancelled).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Routine changes mid-semester", () => {
  // On Sat of week 7 (2026-08-22):
  //  • CSE 4267's Wednesday 08:00 class is edited to Thursday 09:00 (same slot, day changed in the form)
  //  • CSE 4203 gets an additional Thursday 14:00 tutorial
  const CHANGE_DAY = dateOf(7, 6);
  const OLD_WED = slotIdFor("CSE 4267", 3, "08:00");
  let r: SimResult;

  beforeAll(async () => {
    r = await runSemester({
      name: "Routine change",
      summary:
        "After week 7: CSE 4267 Wed 08:00 → Thu 09:00, CSE 4203 adds a Thu 14:00 tutorial. " +
        "Old Wednesday Cloud classes were missed, everything else attended.",
      courses: pick(["CSE 4203", "CSE 4267"]),
      termStart: TERM_START,
      weeks: WEEKS,
      decide: ({ slotId }) => (slotId === OLD_WED ? "missed" : "attended"),
      afterDay: async (date, _week, api) => {
        if (date !== CHANGE_DAY) return;
        const cloud = await api.courseByCode("CSE 4267");
        await api.updateCourse("CSE 4267", {
          slots: cloud.slots.map((s) => (s.id === OLD_WED ? { ...s, day: 4, start: "09:00", end: "09:50" } : s)),
        });
        const cg = await api.courseByCode("CSE 4203");
        await api.updateCourse("CSE 4203", {
          slots: [...cg.slots, { id: "cg-tutorial", day: 4, start: "14:00", end: "14:50" }],
        });
      },
    });
    printReport(r);
  });

  test("consistent — and no phantom unmarked classes before the change", async () => {
    await expectConsistent(r);
    expect(r.backlog).toHaveLength(0);
  });

  test("new and moved slots only apply from the day of the change", async () => {
    const cloud = r.courses.find((c) => c.code === "CSE 4267")!;
    const moved = cloud.slots.find((s) => s.day === 4)!;
    expect(moved.id).not.toBe(OLD_WED);
    expect(moved.from).toBe(CHANGE_DAY);
    const cg = r.courses.find((c) => c.code === "CSE 4203")!;
    expect(cg.slots.find((s) => s.id === "cg-tutorial")!.from).toBe(CHANGE_DAY);
    // untouched slots keep no start date
    expect(cg.slots.filter((s) => s.id !== "cg-tutorial").every((s) => s.from === undefined)).toBe(true);
  });

  test("history from the old Wednesday slot still counts", () => {
    const s = stat(r, "CSE 4267");
    expect(s.held).toBe(3 * WEEKS);
    expect(s.missed).toBe(7); // the 7 Wednesday classes before the change
    expect(s.attended).toBe(3 * WEEKS - 7);
  });

  test("the extra tutorial adds 7 classes (weeks 8–14) to CSE 4203", () => {
    expect(stat(r, "CSE 4203").held).toBe(3 * WEEKS + 7);
  });

  test("an old Wednesday shows the class as a leftover entry; old Thursdays stay empty", async () => {
    const settings = await getSettings();
    const oldWed = dateOf(3, 3);
    const wed = entriesForDate(oldWed, r.courses, await db.records.where("date").equals(oldWed).toArray(), settings);
    const cloudWed = wed.filter((e) => e.course.code === "CSE 4267");
    expect(cloudWed).toHaveLength(1);
    expect(cloudWed[0].orphan).toBe(true);
    expect(cloudWed[0].record?.status).toBe("missed");

    expect(entriesForDate(dateOf(3, 4), r.courses, [], settings)).toHaveLength(0);
    expect(entriesForDate(dateOf(10, 3), r.courses, [], settings).some((e) => e.course.code === "CSE 4267")).toBe(false);
    expect(entriesForDate(dateOf(10, 4), r.courses, [], settings).map((e) => e.course.code).sort()).toEqual([
      "CSE 4203",
      "CSE 4267",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Makeup / extra classes", () => {
  let r: SimResult;
  beforeAll(async () => {
    r = await runSemester({
      name: "Makeup classes",
      summary: "CSE 4227 gets 4 Thursday makeups (3 attended, 1 missed) on top of its routine; everything else attended.",
      courses: pick(["CSE 4227"]),
      termStart: TERM_START,
      weeks: WEEKS,
      decide: () => "attended",
      extras: [3, 6, 9, 12].map((w, i) => ({
        code: "CSE 4227",
        date: dateOf(w, 4),
        start: "14:00",
        end: "15:00",
        status: (i === 3 ? "missed" : "attended") as AttendanceStatus,
      })),
    });
    printReport(r);
  });

  test("consistent", async () => {
    await expectConsistent(r);
  });

  test("extras add to held and attended", () => {
    const s = stat(r, "CSE 4227");
    expect(s.held).toBe(3 * WEEKS + 4);
    expect(s.attended).toBe(3 * WEEKS + 3);
    expect(s.missed).toBe(1);
  });

  test("they appear on their day as extra entries, not in the backlog", async () => {
    const settings = await getSettings();
    const thu = dateOf(6, 4);
    const entries = entriesForDate(thu, r.courses, await db.records.where("date").equals(thu).toArray(), settings);
    expect(entries).toHaveLength(1);
    expect(entries[0].extra).toBe(true);
    expect(entries[0].slotId.startsWith("extra-")).toBe(true);
    expect(r.backlog).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Backup and restore at the end of the semester", () => {
  test("export → wipe → import gives back identical stats", async () => {
    const r = await runSemester({
      name: "Backup roundtrip",
      summary: "Random semester, then a full export/import.",
      courses: SAMPLE_ROUTINE,
      termStart: TERM_START,
      weeks: WEEKS,
      seed: 99,
      settings: { threshold: 70, warnMargin: 8 },
      decide: ({ code, week, rng }) =>
        alternatingLabCancelled(code, week) ? "cancelled" : rng() < 0.08 ? "cancelled" : rng() < 0.8 ? "attended" : "missed",
    });

    const backup = JSON.parse(JSON.stringify(await exportData()));
    await resetAll();
    expect(await db.records.count()).toBe(0);
    await importData(backup);

    const settings = await getSettings();
    expect(settings.threshold).toBe(70);
    expect(settings.warnMargin).toBe(8);
    expect(settings.termStart).toBe(TERM_START);

    const restored = statsByCourse(await db.courses.toArray(), await db.records.toArray(), settings);
    const courses = await db.courses.toArray();
    for (const c of courses) expect(restored.get(c.id!)).toEqual(r.final.get(c.code!)!);
  });
});
