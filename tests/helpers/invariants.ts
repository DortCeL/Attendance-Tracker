import { expect } from "bun:test";
import { db } from "~/database/db";
import type { CourseStats } from "~/lib/stats";
import { tallyPercent, type SimResult } from "./simulator";

const EPS = 1e-9;

/** Checks a CourseStats against the definitions it's supposed to satisfy, independent of how it was computed. */
export function expectStatsInvariants(s: CourseStats) {
  const t = s.threshold / 100;
  expect(s.held).toBe(s.attended + s.missed);

  if (s.held === 0) {
    expect(s.percent).toBeNull();
    expect(s.risk).toBe("none");
  } else {
    expect(s.percent!).toBeCloseTo((s.attended / s.held) * 100, 9);
  }

  // canSkip: you can miss exactly that many in a row and still be at/above threshold, but not one more.
  if (t <= 0) {
    expect(s.canSkip).toBe(Infinity);
  } else {
    expect(Number.isInteger(s.canSkip)).toBe(true);
    expect(s.canSkip).toBeGreaterThanOrEqual(0);
    if (s.canSkip > 0) expect(s.attended / (s.held + s.canSkip)).toBeGreaterThanOrEqual(t - EPS);
    expect(s.attended / (s.held + s.canSkip + 1)).toBeLessThan(t + EPS);
  }

  // needToAttend: attending exactly that many in a row gets you back, one fewer doesn't.
  if (s.percent !== null && s.percent < s.threshold) {
    if (t >= 1) {
      expect(s.needToAttend).toBe(Infinity);
    } else {
      const n = s.needToAttend;
      expect(n).toBeGreaterThanOrEqual(1);
      expect((s.attended + n) / (s.held + n)).toBeGreaterThanOrEqual(t - EPS);
      expect((s.attended + n - 1) / (s.held + n - 1)).toBeLessThan(t);
    }
  } else {
    expect(s.needToAttend).toBe(0);
  }

  if (s.held > 0) {
    expect(s.ifMissNext).toBeCloseTo((s.attended / (s.held + 1)) * 100, 9);
    expect(s.ifAttendNext).toBeCloseTo(((s.attended + 1) / (s.held + 1)) * 100, 9);
  }

  if (s.percent !== null) {
    if (s.percent < s.threshold) expect(s.risk).toBe("danger");
    else expect(s.risk === "safe" || s.risk === "warning").toBe(true);
  }
}

export function expectRiskMatches(s: CourseStats, warnMargin: number) {
  if (s.percent === null) return expect(s.risk).toBe("none");
  if (s.threshold <= 0) return expect(s.risk).toBe("safe");
  if (s.percent < s.threshold) return expect(s.risk).toBe("danger");
  const warn = s.percent < s.threshold + warnMargin || (s.canSkip === 0 && s.held >= 3);
  expect(s.risk).toBe(warn ? "warning" : "safe");
}

/** Everything that must hold for any simulated semester. */
export async function expectConsistent(r: SimResult, opts: { backlog?: boolean } = {}) {
  // 1. The app's numbers match an independent count of what the student did.
  for (const [code, s] of r.final) {
    const t = r.oracle.get(code)!;
    expect({ code, attended: s.attended, missed: s.missed, cancelled: s.cancelled }).toEqual({
      code,
      attended: t.attended,
      missed: t.missed,
      cancelled: t.cancelled,
    });
    const p = tallyPercent(t);
    if (p === null) expect(s.percent).toBeNull();
    else expect(s.percent!).toBeCloseTo(p, 9);
    expectStatsInvariants(s);
    expectRiskMatches(s, r.settings.warnMargin);
  }

  for (const w of r.weekly) {
    for (const s of w.stats.values()) {
      expectStatsInvariants(s);
      expectRiskMatches(s, r.settings.warnMargin);
    }
  }

  // 2. Each mark moves the numbers the right way. Marking "attended" can never hurt and "missed" can
  //    never help, whether it's a new class or a correction.
  const total = (s: CourseStats) => s.attended + s.missed + s.cancelled;
  for (const m of r.marks) {
    const b = m.before;
    const a = m.after;
    const isNew = total(a) === total(b) + 1;
    if (m.status === "attended" && b.percent !== null) {
      expect(a.percent!).toBeGreaterThanOrEqual(b.percent - EPS);
      expect(a.canSkip).toBeGreaterThanOrEqual(b.canSkip);
    }
    if (m.status === "missed" && b.percent !== null && a.percent !== null) {
      expect(a.percent).toBeLessThanOrEqual(b.percent + EPS);
    }
    if (!isNew) {
      expect(total(a)).toBe(total(b));
      continue;
    }
    // A brand-new class: the "if you miss/attend the next one" previews were exactly right.
    if (m.status === "cancelled") {
      expect(a.percent).toBe(b.percent);
      expect(a.held).toBe(b.held);
    }
    if (m.status === "missed" && b.percent !== null) expect(a.percent!).toBeCloseTo(b.ifMissNext, 9);
    if (m.status === "attended" && b.percent !== null) expect(a.percent!).toBeCloseTo(b.ifAttendNext, 9);
  }

  // 3. A warning is shown for exactly the misses that leave a course at risk.
  const atRiskMisses = r.marks.filter(
    (m) => m.status === "missed" && (m.after.risk === "warning" || m.after.risk === "danger"),
  );
  expect(r.alerts.length).toBe(atRiskMisses.length);
  for (const [i, a] of r.alerts.entries()) {
    expect(a.alert.tone).toBe(atRiskMisses[i].after.risk as "warning" | "danger");
  }

  // 4. One record per class (date + slot) — re-marking updates, never duplicates.
  const records = await db.records.toArray();
  const keys = records.map((x) => `${x.date}|${x.slotId}`);
  expect(new Set(keys).size).toBe(keys.length);

  // 5. Every scheduled class without a record is in the backlog, and nothing else is.
  if (opts.backlog !== false) {
    const backlog = r.backlog.map((e) => `${e.date}|${e.slotId}`);
    const unmarked = new Set(r.scheduledKeys);
    for (const rec of records) unmarked.delete(`${rec.date}|${rec.slotId}`);
    expect(backlog.sort()).toEqual([...unmarked].sort());
    for (const f of r.forgotten) expect(unmarked.has(`${f.date}|${f.slotId}`)).toBe(true);
  }
}
