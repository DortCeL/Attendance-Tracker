import { describe, expect, test } from "bun:test";
import { missAlert } from "~/lib/alerts";
import { computeStats } from "~/lib/stats";
import type { AttendanceRecord, AttendanceStatus } from "~/lib/types";

let n = 0;
function s(attended: number, missed: number, threshold = 60, warnMargin = 5) {
  const recs: AttendanceRecord[] = [];
  const push = (status: AttendanceStatus, count: number) => {
    for (let i = 0; i < count; i++) recs.push({ courseId: 1, date: "2026-07-06", slotId: `x${n++}`, status, updatedAt: 0 });
  };
  push("attended", attended);
  push("missed", missed);
  return computeStats(recs, threshold, warnMargin);
}

describe("missAlert", () => {
  test("no alert while comfortably safe", () => {
    expect(missAlert("CG", s(10, 0), s(10, 1), true)).toBeNull();
  });

  test("no alert with nothing held", () => {
    expect(missAlert("CG", s(0, 0), s(0, 0), true)).toBeNull();
  });

  test("warning inside the margin, with remaining skips", () => {
    const a = missAlert("Computer Graphics", s(12, 6), s(12, 7), false)!;
    expect(a.tone).toBe("warning");
    expect(a.title).toBe("Computer Graphics is getting close to 60%");
    expect(a.body).toBe("Now at 63.2%. You can only miss 1 more.");
  });

  test("warning at exactly the threshold", () => {
    const a = missAlert("CG", s(12, 7), s(12, 8), false)!;
    expect(a.tone).toBe("warning");
    expect(a.body).toBe("Now at 60.0%. Missing one more class drops you below the threshold.");
  });

  test("danger, singular and plural", () => {
    const one = missAlert("CG", s(12, 7, 60), s(12, 9, 60), false)!;
    expect(one.tone).toBe("danger");
    expect(one.title).toBe("CG is below 60%");
    expect(one.body).toBe("Now at 57.1%. Attend the next 2 classes to recover.");
    const single = missAlert("CG", s(2, 0, 75), s(2, 1, 75), false)!;
    expect(single.body).toBe("Now at 66.7%. Attend the next 1 class to recover.");
  });

  test("uses the course's own threshold in the title", () => {
    expect(missAlert("DIP", s(7, 2, 80), s(7, 3, 80), false)!.title).toBe("DIP is below 80%");
  });

  describe("system notification", () => {
    test("never when notifications are off", () => {
      expect(missAlert("CG", s(2, 0, 75), s(2, 1, 75), false)!.notify).toBe(false);
    });
    test("when risk gets worse", () => {
      expect(missAlert("CG", s(12, 6), s(12, 7), true)!.notify).toBe(true); // safe → warning
      expect(missAlert("CG", s(12, 8), s(12, 9), true)!.notify).toBe(true); // warning → danger
    });
    test("when risk stays the same", () => {
      expect(missAlert("CG", s(0, 1, 75), s(0, 2, 75), true)!.notify).toBe(true); // danger → danger
    });
    test("not when risk improved (e.g. the threshold was lowered in between)", () => {
      const before = s(5, 5, 80); // danger at 80%
      const after = s(12, 7, 60); // warning at 60%
      expect(before.risk).toBe("danger");
      expect(after.risk).toBe("warning");
      expect(missAlert("CG", before, after, true)!.notify).toBe(false);
    });
  });
});
