import { useLiveQuery } from "dexie-react-hooks";
import { useCallback } from "react";
import { db, getSettings, setAttendance } from "~/database/db";
import { computeStats, effectiveThreshold, type RiskLevel } from "./stats";
import { DEFAULT_SETTINGS, type AttendanceStatus, type Course, type Settings } from "./types";
import { useToast } from "~/components/Toast";
import { notify } from "./notify";

const RISK_RANK: Record<RiskLevel, number> = { none: 0, safe: 1, warning: 2, danger: 3 };

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
      if (after.risk !== "warning" && after.risk !== "danger") return;

      const pct = after.percent!.toFixed(1);
      const title =
        after.risk === "danger"
          ? `${course.title} is below ${threshold}%`
          : `${course.title} is getting close to ${threshold}%`;
      const body =
        after.risk === "danger"
          ? `Now at ${pct}%. Attend the next ${after.needToAttend} class${after.needToAttend === 1 ? "" : "es"} to recover.`
          : after.canSkip === 0
            ? `Now at ${pct}%. Missing one more class drops you below the threshold.`
            : `Now at ${pct}%. You can only miss ${after.canSkip} more.`;

      toast({ title, body, tone: after.risk === "danger" ? "danger" : "warning" });
      if (settings.notifications && RISK_RANK[after.risk] >= RISK_RANK[before.risk]) {
        notify(title, body);
      }
    },
    [toast],
  );
}
