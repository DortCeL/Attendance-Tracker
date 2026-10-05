import { useLiveQuery } from "dexie-react-hooks";
import { useCallback } from "react";
import { db, getSettings, setAttendance } from "~/database/db";
import { computeStats, effectiveThreshold } from "./stats";
import { DEFAULT_SETTINGS, type AttendanceStatus, type Course, type Settings } from "./types";
import { useToast } from "~/components/Toast";
import { missAlert } from "./alerts";
import { notify } from "./notify";

export function useSettings(): Settings {
  return useLiveQuery(getSettings, [], DEFAULT_SETTINGS);
}

export function useCourses(): Course[] | undefined {
  return useLiveQuery(() => db.courses.orderBy("title").toArray(), []);
}

export function useAllRecords() {
  return useLiveQuery(() => db.records.toArray(), []);
}

/**
 * Marks attendance and warns (toast + optional system notification) when the change
 * pushes a course closer to or below its threshold.
 */
export function useMarkAttendance() {
  const toast = useToast();

  return useCallback(
    async (params: {
      course: Course;
      date: string;
      slotId: string;
      status: AttendanceStatus | null;
      start?: string;
      end?: string;
    }) => {
      const { course, ...rest } = params;
      const settings = await getSettings();
      const threshold = effectiveThreshold(course, settings);
      const before = computeStats(
        await db.records.where("courseId").equals(course.id!).toArray(),
        threshold,
        settings.warnMargin,
      );

      await setAttendance({ ...rest, courseId: course.id! });

      if (params.status !== "missed") return;

      const after = computeStats(
        await db.records.where("courseId").equals(course.id!).toArray(),
        threshold,
        settings.warnMargin,
      );
      const alert = missAlert(course.title, before, after, settings.notifications);
      if (!alert) return;
      toast({ title: alert.title, body: alert.body, tone: alert.tone });
      if (alert.notify) notify(alert.title, alert.body);
    },
    [toast],
  );
}
