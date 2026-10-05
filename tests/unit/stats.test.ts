import { describe, expect, test } from "bun:test";
import {
  computeStats,
  effectiveThreshold,
  formatPercent,
  riskMessage,
  statsByCourse,
  type CourseStats,
} from "~/lib/stats";
import { DEFAULT_SETTINGS, type AttendanceRecord, type AttendanceStatus, type Course } from "~/lib/types";
import { expectRiskMatches, expectStatsInvariants } from "../helpers/invariants";

let nextId = 1;
function records(counts: Partial<Record<AttendanceStatus, number>>, courseId = 1): AttendanceRecord[] {
  const out: AttendanceRecord[] = [];
  for (const status of ["attended", "missed", "cancelled"] as const) {
    for (let i = 0; i < (counts[status] ?? 0); i++) {
      out.push({ courseId, date: "2026-07-06", slotId: `s${nextId++}`, status, updatedAt: 0 });
    }
  }
  return out;
}

const stats = (a: number, m: number, threshold = 75, warnMargin = 5, c = 0) =>
  computeStats(records({ attended: a, missed: m, cancelled: c }), threshold, warnMargin);

function course(patch: Partial<Course> = {}): Course {
  return { id: 1, title: "Course", lecturer: "", color: "#000", slots: [], threshold: null, createdAt: 0, ...patch };
}

describe("computeStats — basics", () => {
  test("no records: no percentage, no risk", () => {
    const s = stats(0, 0);
    expect(s.percent).toBeNull();
    expect(s.held).toBe(0);
    expect(s.risk).toBe("none");
    expect(s.canSkip).toBe(0);
    expect(s.needToAttend).toBe(0);
    expect(s.ifAttendNext).toBe(100);
    expect(s.ifMissNext).toBe(0);
  });

  test("only cancelled: still nothing held", () => {
    const s = stats(0, 0, 75, 5, 10);
    expect(s.cancelled).toBe(10);
    expect(s.percent).toBeNull();
    expect(s.risk).toBe("none");
  });

  test("cancelled classes never change the percentage", () => {
    for (let c = 0; c < 20; c++) {
      const s = stats(7, 3, 75, 5, c);
      expect(s.percent).toBeCloseTo(70, 9);
      expect(s.held).toBe(10);
      expect(s.canSkip).toBe(stats(7, 3).canSkip);
    }
  });

  test("percentage is attended / held", () => {
    expect(stats(3, 1).percent).toBe(75);
    expect(stats(2, 1).percent!).toBeCloseTo(66.667, 3);
    expect(stats(10, 0).percent).toBe(100);
    expect(stats(0, 4).percent).toBe(0);
  });

  test("next-class previews", () => {
    const s = stats(3, 1);
    expect(s.ifMissNext).toBe(60);
    expect(s.ifAttendNext).toBe(80);
  });
});

describe("computeStats — canSkip and needToAttend", () => {
  test.each([
    // attended, missed, threshold, canSkip, needToAttend
    [42, 0, 75, 14, 0], // 42/56 = 75%
    [3, 0, 75, 1, 0], // 3/4
    [3, 1, 75, 0, 0], // exactly 75% → can't skip any
    [2, 1, 75, 0, 1], // 66.7% → 3/4 after one more
    [0, 1, 75, 0, 3], // 0/1 → 3/4
    [12, 9, 60, 0, 2], // 57.1% → 14/23 = 60.9%
    [12, 15, 60, 0, 11], // 44.4% → 23/38 = 60.5%
    [3, 2, 60, 0, 0], // exactly 60%
    [7, 3, 70, 0, 0], // exactly 70% (float trap: 7 / 0.7 = 10.000000000000002)
    [7, 2, 70, 1, 0], // 7/10 = 70% after one skip
    [1, 0, 100, 0, 0],
    [9, 1, 100, 0, Infinity], // can never get back to 100%
    [0, 5, 0, Infinity, 0], // no minimum
  ])("%i attended / %i missed @ %i%% → skip %d, need %d", (a, m, t, skip, need) => {
    const s = stats(a, m, t);
    expect(s.canSkip).toBe(skip);
    expect(s.needToAttend).toBe(need);
  });

  test("brute-force agreement over every combination up to 40/40 and many thresholds", () => {
    const thresholds = [0, 1, 33, 50, 60, 65, 66, 67, 70, 74, 75, 76, 80, 85, 90, 99, 100];
    let checked = 0;
    for (const T of thresholds) {
      for (let a = 0; a <= 40; a++) {
        for (let m = 0; m <= 40; m++) {
          const s = stats(a, m, T);
          const h = a + m;

          // Integer arithmetic: a / (h + k) ≥ T/100  ⇔  100a ≥ T(h + k)
          let skip: number;
          if (T === 0) skip = Infinity;
          else {
            skip = 0;
            while (100 * a >= T * (h + skip + 1)) skip++;
          }
          expect(s.canSkip).toBe(skip);

          let need = 0;
          if (h > 0 && 100 * a < T * h) {
            if (T === 100) need = Infinity;
            else while (100 * (a + need) < T * (h + need)) need++;
          }
          expect(s.needToAttend).toBe(need);
          checked++;
        }
      }
    }
    expect(checked).toBe(17 * 41 * 41);
  });

  test("every combination satisfies the stats invariants", () => {
    for (const T of [0, 50, 60, 75, 90, 100]) {
      for (const margin of [0, 5, 10]) {
        for (let a = 0; a <= 25; a++) {
          for (let m = 0; m <= 25; m++) {
            const s = stats(a, m, T, margin);
            expectStatsInvariants(s);
            expectRiskMatches(s, margin);
          }
        }
      }
    }
  });
});

describe("computeStats — risk levels", () => {
  test("below threshold is danger", () => {
    expect(stats(2, 1, 75).risk).toBe("danger");
    expect(stats(59, 41, 60).risk).toBe("danger");
  });

  test("exactly at threshold is not danger", () => {
    expect(stats(3, 2, 60).risk).toBe("warning");
    expect(stats(75, 25, 75).risk).not.toBe("danger");
  });

  test("within the warn margin is a warning", () => {
    expect(stats(64, 36, 60, 5).risk).toBe("warning"); // 64%
    expect(stats(65, 35, 60, 5).risk).toBe("safe"); // 65%: margin is exclusive, and can skip 8
    expect(stats(69, 31, 60, 10).risk).toBe("warning");
  });

  test("warn margin 0: only the 'can't skip' rule warns", () => {
    const one = stats(61, 39, 60, 0); // 61/0.6 = 101.67 → can skip 1
    expect(one.canSkip).toBe(1);
    expect(one.risk).toBe("safe");
    const zero = stats(60, 40, 60, 0);
    expect(zero.canSkip).toBe(0);
    expect(zero.risk).toBe("warning");
  });

  test("can't skip any more → warning once at least 3 classes held", () => {
    // 2/2 at 75%: canSkip 0 but only 2 held → too early to nag
    const early = stats(2, 0, 75, 0);
    expect(early.canSkip).toBe(0);
    expect(early.risk).toBe("safe");
    // 3/3: canSkip 1 → safe; 3/4: canSkip 0 with 4 held → warning
    expect(stats(3, 0, 75, 0).risk).toBe("safe");
    expect(stats(3, 1, 75, 0).risk).toBe("warning");
  });

  test("threshold 0 is always safe, threshold 100 is danger after a single miss", () => {
    expect(stats(0, 10, 0).risk).toBe("safe");
    expect(stats(0, 10, 0, 50).risk).toBe("safe"); // a warn margin doesn't apply when there's no minimum
    expect(riskMessage(stats(0, 10, 0))).toBe("No minimum required");
    expect(stats(10, 0, 100, 0).risk).toBe("warning"); // can't skip
    expect(stats(10, 1, 100).risk).toBe("danger");
  });
});

describe("effectiveThreshold", () => {
  test("uses the course override when set, including 0", () => {
    const settings = { ...DEFAULT_SETTINGS, threshold: 60 };
    expect(effectiveThreshold(course({ threshold: null }), settings)).toBe(60);
    expect(effectiveThreshold(course({ threshold: undefined }), settings)).toBe(60);
    expect(effectiveThreshold(course({ threshold: 80 }), settings)).toBe(80);
    expect(effectiveThreshold(course({ threshold: 0 }), settings)).toBe(0);
  });
});

describe("statsByCourse", () => {
  test("groups records by course, applies per-course thresholds, ignores unknown courses", () => {
    const settings = { ...DEFAULT_SETTINGS, threshold: 60, warnMargin: 5 };
    const a = course({ id: 1, title: "A" });
    const b = course({ id: 2, title: "B", threshold: 80 });
    const c = course({ id: 3, title: "C" });
    const recs = [
      ...records({ attended: 7, missed: 3 }, 1),
      ...records({ attended: 7, missed: 3, cancelled: 2 }, 2),
      ...records({ attended: 5 }, 99), // course was deleted
    ];
    const map = statsByCourse([a, b, c], recs, settings);
    expect([...map.keys()]).toEqual([1, 2, 3]);
    expect(map.get(1)!.risk).toBe("safe");
    expect(map.get(2)!.risk).toBe("danger");
    expect(map.get(2)!.threshold).toBe(80);
    expect(map.get(2)!.cancelled).toBe(2);
    expect(map.get(3)!.risk).toBe("none");
    expect(map.has(99)).toBe(false);
  });
});

describe("formatPercent", () => {
  test("formats and handles null", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(66.666)).toBe("67%");
    expect(formatPercent(66.666, 1)).toBe("66.7%");
    expect(formatPercent(100)).toBe("100%");
  });
});

describe("riskMessage — every branch", () => {
  const msg = (s: CourseStats) => riskMessage(s);

  test("nothing held", () => {
    expect(msg(stats(0, 0))).toBe("No classes recorded yet");
  });
  test("danger, recoverable (singular and plural)", () => {
    expect(msg(stats(2, 1, 75))).toBe("Attend the next 1 class to recover");
    expect(msg(stats(0, 1, 75))).toBe("Attend the next 3 classes to recover");
  });
  test("danger, unrecoverable at 100%", () => {
    expect(msg(stats(9, 1, 100))).toBe("Below threshold");
  });
  test("no minimum", () => {
    expect(msg(stats(1, 5, 0))).toBe("No minimum required");
  });
  test("too early to skip", () => {
    expect(msg(stats(2, 0, 75, 0))).toBe("Too early to skip — only a few classes so far");
  });
  test("one miss from danger", () => {
    expect(msg(stats(3, 1, 75))).toBe("Missing the next class drops you to 60%");
  });
  test("skip budget (singular and plural)", () => {
    expect(msg(stats(3, 0, 75))).toBe("You can miss 1 more class");
    expect(msg(stats(42, 0, 75))).toBe("You can miss 14 more classes");
  });
});
