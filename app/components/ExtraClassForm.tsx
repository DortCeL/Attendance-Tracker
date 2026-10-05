import { useEffect, useState } from "react";
import { addExtraClass } from "~/database/db";
import { formatDateLong, nowHHMM, todayISO } from "~/lib/date";
import type { AttendanceStatus, Course } from "~/lib/types";
import Sheet from "./Sheet";
import { useToast } from "./Toast";

export default function ExtraClassForm({
  open,
  onClose,
  date,
  courses,
}: {
  open: boolean;
  onClose: () => void;
  date: string;
  courses: Course[];
}) {
  const toast = useToast();
  const [courseId, setCourseId] = useState<number | null>(null);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:30");
  const [status, setStatus] = useState<AttendanceStatus>("attended");
  const [error, setError] = useState("");
  const isFuture = date > todayISO();

  useEffect(() => {
    if (!open) return;
    setCourseId(courses[0]?.id ?? null);
    const now = nowHHMM();
    setStart(date === todayISO() ? now.slice(0, 3) + "00" : "09:00");
    setEnd("");
    setStatus(isFuture ? "cancelled" : "attended");
    setError("");
  }, [open, courses, date, isFuture]);

  const save = async () => {
    if (courseId == null) return setError("Pick a course");
    if (end && end <= start) return setError("End time must be after start");
    await addExtraClass({ courseId, date, start, end, status });
    toast({ title: "Extra class added", tone: "success" });
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add extra class"
      footer={
        <div className="flex gap-2">
          <button className="btn-secondary flex-1" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary flex-1" onClick={save}>
            Add
          </button>
        </div>
      }
    >
      <p className="mb-4 text-sm text-zinc-500">
        A one-off or makeup class on <strong className="text-zinc-800 dark:text-zinc-200">{formatDateLong(date)}</strong>. It counts toward
        that course's attendance.
      </p>
      <div className="flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="extra-course">
            Course
          </label>
          <select id="extra-course" className="input" value={courseId ?? ""} onChange={(e) => setCourseId(Number(e.target.value))}>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="extra-start">
              Start
            </label>
            <input id="extra-start" type="time" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="extra-end">
              End
            </label>
            <input id="extra-end" type="time" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <div>
          <span className="label">Status</span>
          <div className="grid grid-cols-3 gap-2">
            {(["attended", "missed", "cancelled"] as AttendanceStatus[]).map((s) => (
              <button
                key={s}
                disabled={isFuture && s !== "cancelled"}
                onClick={() => setStatus(s)}
                className={`rounded-xl border py-2 text-xs font-semibold capitalize transition disabled:opacity-35 ${
                  status === s ? "border-indigo-600 bg-indigo-600 text-white" : "border-zinc-200 dark:border-zinc-700"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="text-sm text-rose-500">{error}</p>}
      </div>
    </Sheet>
  );
}
