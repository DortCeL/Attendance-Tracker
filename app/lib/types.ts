/** 0 = Sunday ... 6 = Saturday (same as Date#getDay) */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Slot {
  id: string;
  day: Weekday;
  /** "HH:MM" 24h */
  start: string;
  end: string;
  room?: string;
  /** "YYYY-MM-DD" the slot joined the routine of a course already in use; it isn't expected before this. */
  from?: string;
}

export interface Course {
  id?: number;
  title: string;
  code?: string;
  lecturer: string;
  color: string;
  slots: Slot[];
  /** Per-course override of the global threshold (percent). */
  threshold?: number | null;
  createdAt: number;
}

export type AttendanceStatus = "attended" | "missed" | "cancelled";

export interface AttendanceRecord {
  id?: number;
  courseId: number;
  /** Local date "YYYY-MM-DD" */
  date: string;
  /** Slot id from the routine, or "extra-<uuid>" for one-off classes. */
  slotId: string;
  status: AttendanceStatus;
  extra?: boolean;
  start?: string;
  end?: string;
  updatedAt: number;
}

export type Theme = "system" | "light" | "dark";

export interface Settings {
  id: "app";
  threshold: number;
  /** Start warning when attendance is within this many percentage points of the threshold. */
  warnMargin: number;
  termStart: string | null;
  weekStart: Weekday;
  theme: Theme;
  notifications: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  id: "app",
  threshold: 75,
  warnMargin: 5,
  termStart: null,
  weekStart: 6,
  theme: "system",
  notifications: false,
};
