import {
  addExtraClass,
  bulkSetAttendance,
  db,
  getSettings,
  resetAll,
  saveCourse,
  setAttendance,
  updateSettings,
} from "~/database/db";
import { missAlert, type AttendanceAlert } from "~/lib/alerts";
import { addDays, parseISODate } from "~/lib/date";
import { entriesForDate, unmarkedBefore, type DayEntry } from "~/lib/schedule";
import { computeStats, effectiveThreshold, statsByCourse, type CourseStats } from "~/lib/stats";
import type { AttendanceStatus, Course, Settings, Slot, Weekday } from "~/lib/types";

export type Rng = () => number;

/** Deterministic PRNG (mulberry32) so every run produces the same semester. */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimCourse {
  code: string;
  title: string;
  lecturer: string;
  slots: Omit<Slot, "id">[];
  threshold?: number | null;
  /** Course is added to the app at the start of this week (1-based). Defaults to week 1. */
  addedOnWeek?: number;
}

export interface ClassContext {
  code: string;
  course: Course;
  date: string;
  /** 1-based week of the term. */
  week: number;
  weekday: Weekday;
  slotId: string;
  start: string;
  /** Stats for this course right before this class (what the app is showing the student). */
  stats: CourseStats;
  rng: Rng;
}

export interface ExtraClass {
  code: string;
  date: string;
  start: string;
  end: string;
  status: AttendanceStatus;
}

export interface SimApi {
  courseByCode(code: string): Promise<Course>;
  mark(code: string, date: string, slotId: string, status: AttendanceStatus | null): Promise<void>;
  updateCourse(code: string, patch: Partial<Course>): Promise<void>;
}

export interface Scenario {
  name: string;
  summary: string;
  courses: SimCourse[];
  termStart: string;
  weeks: number;
  seed?: number;
  settings?: Partial<Omit<Settings, "id">>;
  /** Save termStart in settings (default true). When false the app falls back to each course's createdAt. */
  useTermStart?: boolean;
  /** Whole-day "mark all cancelled" (public holidays, strikes). */
  holidays?: string[];
  /** Weeks where every class is cancelled (exams, breaks). */
  cancelledWeeks?: number[];
  /** The student's choice for each scheduled class. null = forgot to mark it. */
  decide(ctx: ClassContext): AttendanceStatus | null;
  extras?: ExtraClass[];
  /** Runs after every simulated day — used for corrections and routine changes. */
  afterDay?(date: string, week: number, api: SimApi): Promise<void>;
}

export interface MarkEvent {
  code: string;
  date: string;
  week: number;
  slotId: string;
  status: AttendanceStatus;
  before: CourseStats;
  after: CourseStats;
}

export interface AlertEvent {
  code: string;
  date: string;
  week: number;
  alert: AttendanceAlert;
}

export interface Tally {
  attended: number;
  missed: number;
  cancelled: number;
}

export interface SimResult {
  scenario: Scenario;
  settings: Settings;
  courses: Course[];
  endDate: string;
  /** Stats the app computes from what's in the database. */
  final: Map<string, CourseStats>;
  /** Independent count of what the student actually did, for cross-checking `final`. */
  oracle: Map<string, Tally>;
  weekly: { week: number; endDate: string; stats: Map<string, CourseStats> }[];
  marks: MarkEvent[];
  alerts: AlertEvent[];
  forgotten: { code: string; date: string; slotId: string }[];
  /** What the app's "unmarked classes" backlog shows the day after the term ends. */
  backlog: DayEntry[];
  scheduledClasses: number;
  /** `date|slotId` of every routine class that came up while the simulation ran. */
  scheduledKeys: Set<string>;
}

export function slotIdFor(code: string, day: Weekday, start: string): string {
  return `${code.replace(/\s+/g, "")}-${day}-${start}`;
}

export function tallyPercent(t: Tally): number | null {
  const held = t.attended + t.missed;
  return held === 0 ? null : (t.attended / held) * 100;
}

const NOON = 12 * 60 * 60 * 1000;

export async function runSemester(scenario: Scenario): Promise<SimResult> {
  const rng = seeded(scenario.seed ?? 1);
  await resetAll();
  await updateSettings({
    ...scenario.settings,
    termStart: scenario.useTermStart === false ? null : scenario.termStart,
  });

  const specByCode = new Map(scenario.courses.map((c) => [c.code, c]));
  const oracle = new Map<string, Map<string, AttendanceStatus>>(scenario.courses.map((c) => [c.code, new Map()]));
  const marks: MarkEvent[] = [];
  const alerts: AlertEvent[] = [];
  const forgotten: SimResult["forgotten"] = [];
  const weekly: SimResult["weekly"] = [];
  let scheduledClasses = 0;
  const scheduledKeys = new Set<string>();

  const addCourse = async (spec: SimCourse, date: string) => {
    await saveCourse({
      title: spec.title,
      code: spec.code,
      lecturer: spec.lecturer,
      color: "#6366f1",
      slots: spec.slots.map((s) => ({ ...s, id: slotIdFor(spec.code, s.day, s.start) })),
      threshold: spec.threshold ?? null,
      createdAt: parseISODate(date).getTime() + NOON,
    });
  };

  const courseByCode = async (code: string) => {
    const course = (await db.courses.toArray()).find((c) => c.code === code);
    if (!course) throw new Error(`Course ${code} not in the database`);
    return course;
  };

  const statsFor = async (course: Course) => {
    const settings = await getSettings();
    return computeStats(
      await db.records.where("courseId").equals(course.id!).toArray(),
      effectiveThreshold(course, settings),
      settings.warnMargin,
    );
  };

  /** Same steps as useMarkAttendance: stats before → save → stats after → maybe alert. */
  const markLikeTheApp = async (
    course: Course,
    date: string,
    week: number,
    slotId: string,
    status: AttendanceStatus | null,
    times: { start?: string; end?: string } = {},
  ) => {
    const settings = await getSettings();
    const before = await statsFor(course);
    await setAttendance({ courseId: course.id!, date, slotId, status, ...times });
    const after = await statsFor(course);

    const key = `${date}|${slotId}`;
    if (status === null) oracle.get(course.code!)!.delete(key);
    else oracle.get(course.code!)!.set(key, status);
    if (status === null) return;

    marks.push({ code: course.code!, date, week, slotId, status, before, after });
    if (status === "missed") {
      const alert = missAlert(course.title, before, after, settings.notifications);
      if (alert) alerts.push({ code: course.code!, date, week, alert });
    }
  };

  let currentWeek = 1;
  let currentDate = scenario.termStart;
  const api: SimApi = {
    courseByCode,
    mark: async (code, date, slotId, status) =>
      markLikeTheApp(await courseByCode(code), date, currentWeek, slotId, status),
    updateCourse: async (code, patch) => {
      const course = await courseByCode(code);
      await saveCourse({ ...course, ...patch }, currentDate);
    },
  };

  for (const spec of scenario.courses) {
    if ((spec.addedOnWeek ?? 1) === 1) await addCourse(spec, scenario.termStart);
  }

  const totalDays = scenario.weeks * 7;
  for (let i = 0; i < totalDays; i++) {
    const date = addDays(scenario.termStart, i);
    const week = Math.floor(i / 7) + 1;
    currentWeek = week;
    currentDate = date;

    if (i % 7 === 0 && week > 1) {
      for (const spec of scenario.courses) {
        if (spec.addedOnWeek === week) await addCourse(spec, date);
      }
    }

    const settings = await getSettings();
    const courses = await db.courses.toArray();
    const onDate = await db.records.where("date").equals(date).toArray();
    const due = entriesForDate(date, courses, onDate, settings).filter((e) => !e.extra && !e.orphan && !e.record);
    scheduledClasses += due.length;
    for (const e of due) scheduledKeys.add(`${date}|${e.slotId}`);

    if (scenario.holidays?.includes(date) || scenario.cancelledWeeks?.includes(week)) {
      await bulkSetAttendance(
        due.map((e) => ({ courseId: e.course.id!, date, slotId: e.slotId, start: e.start, end: e.end })),
        "cancelled",
      );
      for (const e of due) oracle.get(e.course.code!)!.set(`${date}|${e.slotId}`, "cancelled");
    } else {
      for (const e of due) {
        const status = scenario.decide({
          code: e.course.code!,
          course: e.course,
          date,
          week,
          weekday: parseISODate(date).getDay() as Weekday,
          slotId: e.slotId,
          start: e.start,
          stats: await statsFor(e.course),
          rng,
        });
        if (status === null) forgotten.push({ code: e.course.code!, date, slotId: e.slotId });
        else await markLikeTheApp(e.course, date, week, e.slotId, status);
      }
    }

    for (const x of scenario.extras ?? []) {
      if (x.date !== date) continue;
      const course = await courseByCode(x.code);
      const id = await addExtraClass({ courseId: course.id!, date, start: x.start, end: x.end, status: x.status });
      const record = await db.records.get(id);
      oracle.get(x.code)!.set(`${date}|${record!.slotId}`, x.status);
    }

    await scenario.afterDay?.(date, week, api);

    if (i % 7 === 6) {
      weekly.push({ week, endDate: date, stats: await snapshot(specByCode) });
    }
  }

  const endDate = addDays(scenario.termStart, totalDays - 1);
  const settings = await getSettings();
  const courses = await db.courses.toArray();
  const records = await db.records.toArray();

  const tallies = new Map<string, Tally>();
  for (const [code, map] of oracle) {
    const t: Tally = { attended: 0, missed: 0, cancelled: 0 };
    for (const s of map.values()) t[s]++;
    tallies.set(code, t);
  }

  return {
    scenario,
    settings,
    courses,
    endDate,
    final: await snapshot(specByCode),
    oracle: tallies,
    weekly,
    marks,
    alerts,
    forgotten,
    backlog: unmarkedBefore(courses, records, settings, addDays(endDate, 1)),
    scheduledClasses,
    scheduledKeys,
  };
}

async function snapshot(specByCode: Map<string, SimCourse>): Promise<Map<string, CourseStats>> {
  const [courses, records, settings] = await Promise.all([db.courses.toArray(), db.records.toArray(), getSettings()]);
  const byId = statsByCourse(courses, records, settings);
  const out = new Map<string, CourseStats>();
  for (const c of courses) if (specByCode.has(c.code!)) out.set(c.code!, byId.get(c.id!)!);
  return out;
}
