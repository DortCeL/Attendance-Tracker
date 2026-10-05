import Dexie, { type Table } from "dexie";
import {
  DEFAULT_SETTINGS,
  type AttendanceRecord,
  type AttendanceStatus,
  type Course,
  type Settings,
} from "~/lib/types";
import { COURSE_COLORS } from "~/lib/colors";
import { uid } from "~/lib/uid";

export class CourseDB extends Dexie {
  courses!: Table<Course, number>;
  records!: Table<AttendanceRecord, number>;
  settings!: Table<Settings, string>;

  constructor() {
    super("CourseDB");
    this.version(1).stores({
      courses: "++id, title, lecturer",
    });
    this.version(2)
      .stores({
        courses: "++id, title",
        records: "++id, courseId, date, &[date+slotId], [courseId+date]",
        settings: "id",
      })
      .upgrade(async (tx) => {
        let i = 0;
        await tx
          .table("courses")
          .toCollection()
          .modify((c: Partial<Course>) => {
            c.color ??= COURSE_COLORS[i++ % COURSE_COLORS.length];
            c.slots ??= [];
            c.createdAt ??= Date.now();
          });
      });
  }
}

export const db = new CourseDB();

// ---------- Courses ----------

export async function saveCourse(course: Course): Promise<number> {
  if (course.id != null) {
    await db.courses.put(course);
    return course.id;
  }
  return db.courses.add({ ...course, createdAt: course.createdAt || Date.now() });
}

export async function deleteCourse(id: number) {
  await db.transaction("rw", db.courses, db.records, async () => {
    await db.records.where("courseId").equals(id).delete();
    await db.courses.delete(id);
  });
}

// ---------- Attendance ----------

export async function setAttendance(params: {
  courseId: number;
  date: string;
  slotId: string;
  status: AttendanceStatus | null;
  start?: string;
  end?: string;
  extra?: boolean;
}) {
  const { courseId, date, slotId, status, start, end, extra } = params;
  const existing = await db.records.where({ date, slotId }).first();

  if (status === null) {
    if (existing?.id != null) await db.records.delete(existing.id);
    return;
  }

  if (existing?.id != null) {
    await db.records.update(existing.id, { status, updatedAt: Date.now() });
  } else {
    await db.records.add({
      courseId,
      date,
      slotId,
      status,
      start,
      end,
      extra,
      updatedAt: Date.now(),
    });
  }
}

export async function addExtraClass(params: {
  courseId: number;
  date: string;
  start: string;
  end: string;
  status: AttendanceStatus;
}) {
  return db.records.add({
    ...params,
    slotId: `extra-${uid()}`,
    extra: true,
    updatedAt: Date.now(),
  });
}

export async function deleteRecord(id: number) {
  await db.records.delete(id);
}

export async function bulkSetAttendance(
  items: { courseId: number; date: string; slotId: string; start?: string; end?: string }[],
  status: AttendanceStatus,
) {
  await db.transaction("rw", db.records, async () => {
    for (const item of items) {
      await setAttendance({ ...item, status });
    }
  });
}

// ---------- Settings ----------

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get("app");
  return { ...DEFAULT_SETTINGS, ...s };
}

export async function updateSettings(patch: Partial<Omit<Settings, "id">>) {
  const current = await getSettings();
  await db.settings.put({ ...current, ...patch, id: "app" });
}

// ---------- Backup ----------

export interface BackupFile {
  app: "attendance-tracker";
  version: 2;
  exportedAt: string;
  courses: Course[];
  records: AttendanceRecord[];
  settings: Settings;
}

export async function exportData(): Promise<BackupFile> {
  const [courses, records, settings] = await Promise.all([
    db.courses.toArray(),
    db.records.toArray(),
    getSettings(),
  ]);
  return {
    app: "attendance-tracker",
    version: 2,
    exportedAt: new Date().toISOString(),
    courses,
    records,
    settings,
  };
}

export async function importData(data: unknown) {
  const file = data as Partial<BackupFile>;
  if (file?.app !== "attendance-tracker" || !Array.isArray(file.courses) || !Array.isArray(file.records)) {
    throw new Error("This doesn't look like an Attendance Tracker backup.");
  }
  await db.transaction("rw", db.courses, db.records, db.settings, async () => {
    await Promise.all([db.courses.clear(), db.records.clear(), db.settings.clear()]);
    await db.courses.bulkAdd(file.courses!);
    await db.records.bulkAdd(file.records!);
    await db.settings.put({ ...DEFAULT_SETTINGS, ...file.settings, id: "app" });
  });
}

export async function resetAll() {
  await db.transaction("rw", db.courses, db.records, db.settings, async () => {
    await Promise.all([db.courses.clear(), db.records.clear(), db.settings.clear()]);
  });
}

export async function clearAttendance() {
  await db.records.clear();
}
