import { beforeEach, describe, expect, test } from "bun:test";
import {
  addExtraClass,
  bulkSetAttendance,
  clearAttendance,
  db,
  deleteCourse,
  deleteRecord,
  exportData,
  getSettings,
  importCourses,
  importData,
  resetAll,
  saveCourse,
  setAttendance,
  updateSettings,
} from "~/database/db";
import { DEFAULT_SETTINGS, type Course, type Slot } from "~/lib/types";

const MON = "2026-07-06";

function newCourse(title: string, slots: Slot[] = [], patch: Partial<Course> = {}): Course {
  return { title, code: "", lecturer: "", color: "#000", slots, threshold: null, createdAt: 0, ...patch };
}

const slot = (id: string, day: Slot["day"], start: string, end = "10:00"): Slot => ({ id, day, start, end });

beforeEach(async () => {
  await resetAll();
});

describe("setAttendance", () => {
  test("creates, updates in place, and deletes on null", async () => {
    const id = await saveCourse(newCourse("CG", [slot("a", 1, "09:00")]));
    await setAttendance({ courseId: id, date: MON, slotId: "a", status: "attended" });
    const first = await db.records.toArray();
    expect(first).toHaveLength(1);
    expect(first[0].status).toBe("attended");

    await setAttendance({ courseId: id, date: MON, slotId: "a", status: "missed" });
    const second = await db.records.toArray();
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe(first[0].id);
    expect(second[0].status).toBe("missed");

    await setAttendance({ courseId: id, date: MON, slotId: "a", status: null });
    expect(await db.records.count()).toBe(0);
  });

  test("un-marking something that was never marked is a no-op", async () => {
    await setAttendance({ courseId: 1, date: MON, slotId: "nope", status: null });
    expect(await db.records.count()).toBe(0);
  });

  test("same slot on different dates are separate records", async () => {
    await setAttendance({ courseId: 1, date: MON, slotId: "a", status: "attended" });
    await setAttendance({ courseId: 1, date: "2026-07-13", slotId: "a", status: "attended" });
    expect(await db.records.count()).toBe(2);
  });

  test("the database refuses two records for the same date + slot", async () => {
    await db.records.add({ courseId: 1, date: MON, slotId: "a", status: "attended", updatedAt: 0 });
    const duplicate = db.records.add({ courseId: 1, date: MON, slotId: "a", status: "missed", updatedAt: 0 });
    await expect(Promise.resolve(duplicate)).rejects.toThrow();
    expect(await db.records.count()).toBe(1);
  });
});

describe("bulkSetAttendance", () => {
  test("marks a whole day, overwriting what was already there", async () => {
    await setAttendance({ courseId: 1, date: MON, slotId: "a", status: "attended" });
    await bulkSetAttendance(
      [
        { courseId: 1, date: MON, slotId: "a" },
        { courseId: 1, date: MON, slotId: "b" },
        { courseId: 2, date: MON, slotId: "c" },
      ],
      "cancelled",
    );
    const recs = await db.records.toArray();
    expect(recs).toHaveLength(3);
    expect(recs.every((r) => r.status === "cancelled")).toBe(true);
  });
});

describe("extra classes", () => {
  test("each extra gets its own slot id, even at the same time", async () => {
    await addExtraClass({ courseId: 1, date: MON, start: "14:00", end: "15:00", status: "attended" });
    await addExtraClass({ courseId: 1, date: MON, start: "14:00", end: "15:00", status: "missed" });
    const recs = await db.records.toArray();
    expect(recs).toHaveLength(2);
    expect(recs.every((r) => r.extra && r.slotId.startsWith("extra-"))).toBe(true);
    expect(recs[0].slotId).not.toBe(recs[1].slotId);
  });

  test("deleteRecord removes one", async () => {
    const id = await addExtraClass({ courseId: 1, date: MON, start: "14:00", end: "15:00", status: "attended" });
    await deleteRecord(id);
    expect(await db.records.count()).toBe(0);
  });
});

describe("courses", () => {
  test("new course gets a createdAt", async () => {
    const before = Date.now();
    const id = await saveCourse(newCourse("CG"));
    expect((await db.courses.get(id))!.createdAt).toBeGreaterThanOrEqual(before);
  });

  test("deleting a course removes only its records", async () => {
    const a = await saveCourse(newCourse("A"));
    const b = await saveCourse(newCourse("B"));
    await setAttendance({ courseId: a, date: MON, slotId: "a1", status: "attended" });
    await setAttendance({ courseId: b, date: MON, slotId: "b1", status: "attended" });
    await deleteCourse(a);
    expect(await db.courses.count()).toBe(1);
    expect((await db.records.toArray()).map((r) => r.courseId)).toEqual([b]);
  });

  describe("editing the routine of a course", () => {
    test("while still setting up (no attendance yet), new slots apply from the start", async () => {
      const id = await saveCourse(newCourse("CG", [slot("a", 1, "09:00")]));
      const c = (await db.courses.get(id))!;
      await saveCourse({ ...c, slots: [...c.slots, slot("b", 2, "09:00")] }, "2026-08-20");
      const saved = (await db.courses.get(id))!;
      expect(saved.slots.map((s) => s.from)).toEqual([undefined, undefined]);
    });

    test("once in use, a new slot starts on the day it was added", async () => {
      const id = await saveCourse(newCourse("CG", [slot("a", 1, "09:00")]));
      await setAttendance({ courseId: id, date: MON, slotId: "a", status: "attended" });
      const c = (await db.courses.get(id))!;
      await saveCourse({ ...c, slots: [...c.slots, slot("b", 2, "09:00")] }, "2026-08-20");
      const saved = (await db.courses.get(id))!;
      expect(saved.slots.find((s) => s.id === "a")!.from).toBeUndefined();
      expect(saved.slots.find((s) => s.id === "b")!.from).toBe("2026-08-20");
    });

    test("moving a slot to another weekday gives it a new id so old records become leftovers", async () => {
      const id = await saveCourse(newCourse("CG", [slot("a", 1, "09:00")]));
      await setAttendance({ courseId: id, date: MON, slotId: "a", status: "missed" });
      const c = (await db.courses.get(id))!;
      await saveCourse({ ...c, slots: [{ ...c.slots[0], day: 4 }] }, "2026-08-20");
      const moved = (await db.courses.get(id))!.slots[0];
      expect(moved.id).not.toBe("a");
      expect(moved.day).toBe(4);
      expect(moved.from).toBe("2026-08-20");
      expect((await db.records.toArray())[0].slotId).toBe("a");
    });

    test("changing only the time keeps the slot (and its history)", async () => {
      const id = await saveCourse(newCourse("CG", [slot("a", 1, "09:00")]));
      await setAttendance({ courseId: id, date: MON, slotId: "a", status: "attended" });
      const c = (await db.courses.get(id))!;
      await saveCourse({ ...c, slots: [{ ...c.slots[0], start: "10:00", end: "11:00" }] }, "2026-08-20");
      const s = (await db.courses.get(id))!.slots[0];
      expect(s.id).toBe("a");
      expect(s.from).toBeUndefined();
    });
  });
});

describe("importCourses", () => {
  test("adds new courses with colors and no threshold override", async () => {
    await importCourses([
      { title: "Computer Graphics", code: "CSE 4203", lecturer: "RZC", slots: [slot("x", 1, "09:40")] },
      { title: "Cloud Computing", code: "CSE 4267", lecturer: "TFQ", slots: [] },
    ]);
    const courses = await db.courses.toArray();
    expect(courses.map((c) => c.code)).toEqual(["CSE 4203", "CSE 4267"]);
    expect(courses.every((c) => c.threshold === null && c.color.startsWith("#") && c.createdAt > 0)).toBe(true);
    expect(courses[0].color).not.toBe(courses[1].color);
  });

  test("updating an existing course keeps its name and reuses slot ids by day + start", async () => {
    const id = await saveCourse(
      newCourse("My CG name", [slot("keep", 1, "09:40", "10:30"), slot("drop", 3, "08:50")], { code: "CSE 4203" }),
    );
    await setAttendance({ courseId: id, date: MON, slotId: "keep", status: "attended" });

    await importCourses(
      [
        { title: "CSE 4203", code: "CSE 4203", lecturer: "RZC", slots: [slot("fresh1", 1, "09:40", "10:30")], existingId: id },
        { title: "CSE 4203", code: "CSE 4203", lecturer: "RZC", slots: [slot("fresh2", 4, "14:00")], existingId: id },
      ],
      "2026-08-20",
    );

    const c = (await db.courses.get(id))!;
    expect(await db.courses.count()).toBe(1);
    expect(c.title).toBe("My CG name");
    expect(c.lecturer).toBe("RZC"); // filled in because it was empty
    expect(c.slots.map((s) => s.id)).toEqual(["keep", "fresh2"]);
    expect(c.slots.find((s) => s.id === "keep")!.from).toBeUndefined();
    expect(c.slots.find((s) => s.id === "fresh2")!.from).toBe("2026-08-20");
  });
});

describe("settings", () => {
  test("defaults when nothing is saved", async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  test("partial updates merge", async () => {
    await updateSettings({ threshold: 60 });
    await updateSettings({ warnMargin: 10 });
    const s = await getSettings();
    expect(s.threshold).toBe(60);
    expect(s.warnMargin).toBe(10);
    expect(s.weekStart).toBe(DEFAULT_SETTINGS.weekStart);
  });
});

describe("backup", () => {
  test("export → import roundtrip", async () => {
    const id = await saveCourse(newCourse("CG", [slot("a", 1, "09:00")]));
    await setAttendance({ courseId: id, date: MON, slotId: "a", status: "attended" });
    await addExtraClass({ courseId: id, date: MON, start: "14:00", end: "15:00", status: "missed" });
    await updateSettings({ threshold: 65, termStart: "2026-07-05" });

    const file = JSON.parse(JSON.stringify(await exportData()));
    expect(file.app).toBe("attendance-tracker");
    expect(file.version).toBe(2);

    await resetAll();
    await importData(file);
    expect(await db.courses.toArray()).toEqual(file.courses);
    expect(await db.records.toArray()).toEqual(file.records);
    expect((await getSettings()).threshold).toBe(65);
  });

  test("import replaces existing data", async () => {
    await saveCourse(newCourse("Old"));
    await importData({ app: "attendance-tracker", version: 2, courses: [], records: [], settings: {} });
    expect(await db.courses.count()).toBe(0);
  });

  test("rejects files that aren't backups and leaves data alone", async () => {
    await saveCourse(newCourse("Keep me"));
    for (const junk of [null, {}, { app: "other" }, { app: "attendance-tracker", courses: "x", records: [] }]) {
      await expect(importData(junk)).rejects.toThrow("doesn't look like an Attendance Tracker backup");
    }
    expect(await db.courses.count()).toBe(1);
  });
});

describe("clearing", () => {
  test("clearAttendance keeps courses and settings", async () => {
    await saveCourse(newCourse("CG"));
    await updateSettings({ threshold: 60 });
    await setAttendance({ courseId: 1, date: MON, slotId: "a", status: "attended" });
    await clearAttendance();
    expect(await db.records.count()).toBe(0);
    expect(await db.courses.count()).toBe(1);
    expect((await getSettings()).threshold).toBe(60);
  });

  test("resetAll wipes everything", async () => {
    await saveCourse(newCourse("CG"));
    await updateSettings({ threshold: 60 });
    await setAttendance({ courseId: 1, date: MON, slotId: "a", status: "attended" });
    await resetAll();
    expect(await db.records.count()).toBe(0);
    expect(await db.courses.count()).toBe(0);
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
