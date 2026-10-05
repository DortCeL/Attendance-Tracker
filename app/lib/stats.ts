import type { AttendanceRecord, Course, Settings } from "./types";

export type RiskLevel = "none" | "safe" | "warning" | "danger";

export interface CourseStats {
  attended: number;
  missed: number;
  cancelled: number;
  /** Classes that actually happened (attended + missed). */
  held: number;
  /** null when no class has been held yet. */
  percent: number | null;
  threshold: number;
  /** How many more classes can be missed in a row while staying at/above threshold. */
  canSkip: number;
  /** How many classes in a row must be attended to get back to threshold. */
  needToAttend: number;
  /** Percentage if the next class is missed. */
  ifMissNext: number;
  /** Percentage if the next class is attended. */
  ifAttendNext: number;
  risk: RiskLevel;
}

const MIN_HELD_FOR_SKIP_WARNING = 3;

export function effectiveThreshold(course: Course, settings: Settings): number {
  return course.threshold ?? settings.threshold;
}

export function computeStats(
  records: AttendanceRecord[],
  threshold: number,
  warnMargin: number,
): CourseStats {
  let attended = 0;
  let missed = 0;
  let cancelled = 0;
  for (const r of records) {
    if (r.status === "attended") attended++;
    else if (r.status === "missed") missed++;
    else cancelled++;
  }
  const held = attended + missed;
  const percent = held === 0 ? null : (attended / held) * 100;
  const t = threshold / 100;

  // Largest k with attended / (held + k) >= t
  const canSkip = t <= 0 ? Infinity : Math.max(0, Math.floor(attended / t - held + 1e-9));

  // Smallest n with (attended + n) / (held + n) >= t
  let needToAttend = 0;
  if (percent !== null && percent < threshold) {
    needToAttend = t >= 1 ? Infinity : Math.ceil((t * held - attended) / (1 - t) - 1e-9);
  }

  const ifMissNext = (attended / (held + 1)) * 100;
  const ifAttendNext = ((attended + 1) / (held + 1)) * 100;

  // With only a couple of classes held, a single miss swings the percentage wildly,
  // so the "next miss drops you below" rule only kicks in once there's some history.
  const oneMissFromDanger = canSkip === 0 && held >= MIN_HELD_FOR_SKIP_WARNING;

  let risk: RiskLevel;
  if (percent === null) risk = "none";
  else if (t <= 0) risk = "safe";
  else if (percent < threshold) risk = "danger";
  else if (percent < threshold + warnMargin || oneMissFromDanger) risk = "warning";
  else risk = "safe";

  return {
    attended,
    missed,
    cancelled,
    held,
    percent,
    threshold,
    canSkip,
    needToAttend,
    ifMissNext,
    ifAttendNext,
    risk,
  };
}

export function statsByCourse(
  courses: Course[],
  records: AttendanceRecord[],
  settings: Settings,
): Map<number, CourseStats> {
  const grouped = new Map<number, AttendanceRecord[]>();
  for (const r of records) {
    const list = grouped.get(r.courseId);
    if (list) list.push(r);
    else grouped.set(r.courseId, [r]);
  }
  const out = new Map<number, CourseStats>();
  for (const c of courses) {
    out.set(
      c.id!,
      computeStats(grouped.get(c.id!) ?? [], effectiveThreshold(c, settings), settings.warnMargin),
    );
  }
  return out;
}

export function formatPercent(p: number | null, digits = 0): string {
  if (p === null) return "—";
  return `${p.toFixed(digits)}%`;
}

export function riskMessage(s: CourseStats): string {
  if (s.risk === "none") return "No classes recorded yet";
  if (s.risk === "danger") {
    return s.needToAttend === Infinity
      ? "Below threshold"
      : `Attend the next ${s.needToAttend} class${s.needToAttend === 1 ? "" : "es"} to recover`;
  }
  if (s.canSkip === Infinity) return "No minimum required";
  if (s.canSkip === 0) {
    return s.risk === "safe"
      ? "Too early to skip — only a few classes so far"
      : `Missing the next class drops you to ${s.ifMissNext.toFixed(0)}%`;
  }
  return `You can miss ${s.canSkip} more class${s.canSkip === 1 ? "" : "es"}`;
}

export const RISK_STYLES: Record<RiskLevel, { text: string; bg: string; bar: string; label: string }> = {
  none: {
    text: "text-zinc-500 dark:text-zinc-400",
    bg: "bg-zinc-100 dark:bg-zinc-800",
    bar: "bg-zinc-400",
    label: "No data",
  },
  safe: {
    text: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-500/10",
    bar: "bg-emerald-500",
    label: "Safe",
  },
  warning: {
    text: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-500/10",
    bar: "bg-amber-500",
    label: "Close call",
  },
  danger: {
    text: "text-rose-600 dark:text-rose-400",
    bg: "bg-rose-50 dark:bg-rose-500/10",
    bar: "bg-rose-500",
    label: "Below threshold",
  },
};
