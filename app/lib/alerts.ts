import type { CourseStats, RiskLevel } from "./stats";

export interface AttendanceAlert {
  title: string;
  body: string;
  tone: "warning" | "danger";
  /** Also show a system notification (only when the risk didn't improve). */
  notify: boolean;
}

const RISK_RANK: Record<RiskLevel, number> = { none: 0, safe: 1, warning: 2, danger: 3 };

/** What to tell the user after marking a class as missed, or null when the course is still comfortable. */
export function missAlert(
  courseTitle: string,
  before: CourseStats,
  after: CourseStats,
  notificationsEnabled: boolean,
): AttendanceAlert | null {
  if (after.risk !== "warning" && after.risk !== "danger") return null;

  const pct = after.percent!.toFixed(1);
  const danger = after.risk === "danger";
  const title = danger
    ? `${courseTitle} is below ${after.threshold}%`
    : `${courseTitle} is getting close to ${after.threshold}%`;
  const body = danger
    ? `Now at ${pct}%. Attend the next ${after.needToAttend} class${after.needToAttend === 1 ? "" : "es"} to recover.`
    : after.canSkip === 0
      ? `Now at ${pct}%. Missing one more class drops you below the threshold.`
      : `Now at ${pct}%. You can only miss ${after.canSkip} more.`;

  return {
    title,
    body,
    tone: danger ? "danger" : "warning",
    notify: notificationsEnabled && RISK_RANK[after.risk] >= RISK_RANK[before.risk],
  };
}
