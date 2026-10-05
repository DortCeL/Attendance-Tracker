import { addDays, toISODate, todayISO, weekdayOf } from "./date";
import type { AttendanceRecord, Course, Settings } from "./types";

export interface DayEntry {
  key: string;
  course: Course;
  date: string;
  slotId: string;
  start: string;
  end: string;
  room?: string;
  record?: AttendanceRecord;
  extra: boolean;
  /** The routine slot this record belonged to no longer exists. */
  orphan: boolean;
}

/** First date on which a course's classes count as "expected" (for the unmarked backlog). */
export function courseStartDate(course: Course, settings: Settings): string {
  return settings.termStart ?? toISODate(new Date(course.createdAt));
}

export function entriesForDate(
  date: string,
  courses: Course[],
  recordsOnDate: AttendanceRecord[],
  settings: Settings,
): DayEntry[] {
  const weekday = weekdayOf(date);
  const bySlot = new Map(recordsOnDate.map((r) => [r.slotId, r]));
  const used = new Set<string>();
  const entries: DayEntry[] = [];
  const beforeTerm = settings.termStart != null && date < settings.termStart;

  if (!beforeTerm) {
    for (const course of courses) {
      for (const slot of course.slots) {
        if (slot.day !== weekday) continue;
        const record = bySlot.get(slot.id);
        if (record) used.add(slot.id);
        entries.push({
          key: `${date}-${slot.id}`,
          course,
          date,
          slotId: slot.id,
          start: slot.start,
          end: slot.end,
          room: slot.room,
          record,
          extra: false,
          orphan: false,
        });
      }
    }
  }

  const courseById = new Map(courses.map((c) => [c.id!, c]));
  for (const record of recordsOnDate) {
    if (used.has(record.slotId)) continue;
    const course = courseById.get(record.courseId);
    if (!course) continue;
    entries.push({
      key: `${date}-${record.slotId}`,
      course,
      date,
      slotId: record.slotId,
      start: record.start ?? "",
      end: record.end ?? "",
      record,
      extra: !!record.extra,
      orphan: !record.extra,
    });
  }

  return entries.sort((a, b) => a.start.localeCompare(b.start) || a.course.title.localeCompare(b.course.title));
}

const MAX_BACKLOG_DAYS = 200;

/** Scheduled classes before today that haven't been marked yet, newest first. */
export function unmarkedBefore(
  courses: Course[],
  records: AttendanceRecord[],
  settings: Settings,
  until: string = todayISO(),
): DayEntry[] {
  const marked = new Set(records.map((r) => `${r.date}|${r.slotId}`));
  const out: DayEntry[] = [];
  const earliest = addDays(until, -MAX_BACKLOG_DAYS);

  for (const course of courses) {
    if (course.slots.length === 0) continue;
    let date = courseStartDate(course, settings);
    if (date < earliest) date = earliest;
    for (; date < until; date = addDays(date, 1)) {
      const weekday = weekdayOf(date);
      for (const slot of course.slots) {
        if (slot.day !== weekday || marked.has(`${date}|${slot.id}`)) continue;
        out.push({
          key: `${date}-${slot.id}`,
          course,
          date,
          slotId: slot.id,
          start: slot.start,
          end: slot.end,
          room: slot.room,
          extra: false,
          orphan: false,
        });
      }
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.start.localeCompare(b.start));
}
