import { Plus, Trash } from "lucide-react";
import { useEffect, useState } from "react";
import { deleteCourse, saveCourse } from "~/database/db";
import { COURSE_COLORS } from "~/lib/colors";
import { DAY_SHORT, orderedWeekdays } from "~/lib/date";
import { useSettings } from "~/lib/hooks";
import type { Course, Slot, Weekday } from "~/lib/types";
import { uid } from "~/lib/uid";
import Sheet, { ConfirmSheet } from "./Sheet";
import { useToast } from "./Toast";

function blankCourse(index: number): Course {
  return {
    title: "",
    code: "",
    lecturer: "",
    color: COURSE_COLORS[index % COURSE_COLORS.length],
    slots: [],
    threshold: null,
    createdAt: 0,
  };
}

export default function CourseForm({
  open,
  onClose,
  course,
  courseCount,
}: {
  open: boolean;
  onClose: () => void;
  course: Course | null;
  courseCount: number;
}) {
  const settings = useSettings();
  const toast = useToast();
  const [draft, setDraft] = useState<Course>(() => course ?? blankCourse(courseCount));
  const [customThreshold, setCustomThreshold] = useState(course?.threshold != null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(course ? structuredClone(course) : blankCourse(courseCount));
    setCustomThreshold(course?.threshold != null);
    setErrors({});
  }, [open, course, courseCount]);

  const set = <K extends keyof Course>(key: K, value: Course[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const updateSlot = (id: string, patch: Partial<Slot>) =>
    set(
      "slots",
      draft.slots.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );

  const addSlot = () => {
    const last = draft.slots.at(-1);
    const days = orderedWeekdays(settings.weekStart);
    const day = last ? days[(days.indexOf(last.day) + 1) % 7] : days[0];
    set("slots", [
      ...draft.slots,
      { id: uid(), day, start: last?.start ?? "09:00", end: last?.end ?? "10:30", room: last?.room ?? "" },
    ]);
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!draft.title.trim()) e.title = "Give the course a name";
    for (const s of draft.slots) {
      if (!s.start || !s.end) e[s.id] = "Set both times";
      else if (s.end <= s.start) e[s.id] = "End time must be after start";
    }
    if (customThreshold) {
      const t = draft.threshold ?? NaN;
      if (!(t >= 0 && t <= 100)) e.threshold = "Enter 0–100";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    await saveCourse({
      ...draft,
      title: draft.title.trim(),
      code: draft.code?.trim(),
      lecturer: draft.lecturer.trim(),
      threshold: customThreshold ? draft.threshold : null,
      slots: draft.slots.map((s) => ({ ...s, room: s.room?.trim() || undefined })),
    });
    toast({ title: course ? "Course updated" : "Course added", tone: "success" });
    onClose();
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={course ? "Edit course" : "New course"}
        footer={
          <div className="flex gap-2">
            {course && (
              <button className="btn-secondary text-rose-600 dark:text-rose-400" onClick={() => setConfirmDelete(true)} aria-label="Delete course">
                <Trash className="size-4" />
              </button>
            )}
            <button className="btn-secondary flex-1" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary flex-1" onClick={handleSave}>
              Save
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div>
            <label className="label" htmlFor="course-title">
              Course name
            </label>
            <input
              id="course-title"
              className="input"
              placeholder="e.g. Data Structures & Algorithms"
              value={draft.title}
              autoFocus={!course}
              onChange={(e) => set("title", e.target.value)}
            />
            {errors.title && <p className="mt-1 text-xs text-rose-500">{errors.title}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="course-code">
                Code
              </label>
              <input id="course-code" className="input" placeholder="CSE 221" value={draft.code ?? ""} onChange={(e) => set("code", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="course-lecturer">
                Lecturer
              </label>
              <input
                id="course-lecturer"
                className="input"
                placeholder="Optional"
                value={draft.lecturer}
                onChange={(e) => set("lecturer", e.target.value)}
              />
            </div>
          </div>

          <div>
            <span className="label">Color</span>
            <div className="flex flex-wrap gap-2">
              {COURSE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  onClick={() => set("color", c)}
                  className={`size-8 rounded-full transition ${draft.color === c ? "scale-110 ring-2 ring-offset-2 ring-zinc-900 dark:ring-white dark:ring-offset-zinc-900" : ""}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="label mb-0">Weekly classes</span>
              <span className="text-xs text-zinc-500">{draft.slots.length} per week</span>
            </div>
            <div className="flex flex-col gap-2">
              {draft.slots.map((slot) => (
                <div key={slot.id} className="rounded-2xl border border-zinc-200 p-3 dark:border-zinc-700">
                  <div className="flex flex-wrap gap-1">
                    {orderedWeekdays(settings.weekStart).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => updateSlot(slot.id, { day: d as Weekday })}
                        className={`rounded-lg px-2 py-1 text-xs font-semibold transition ${
                          slot.day === d
                            ? "bg-indigo-600 text-white"
                            : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                        }`}
                      >
                        {DAY_SHORT[d]}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="time"
                      aria-label="Start time"
                      className="input px-2"
                      value={slot.start}
                      onChange={(e) => updateSlot(slot.id, { start: e.target.value })}
                    />
                    <span className="text-zinc-400">–</span>
                    <input
                      type="time"
                      aria-label="End time"
                      className="input px-2"
                      value={slot.end}
                      onChange={(e) => updateSlot(slot.id, { end: e.target.value })}
                    />
                    <button
                      type="button"
                      aria-label="Remove class time"
                      className="icon-btn shrink-0 hover:text-rose-600"
                      onClick={() =>
                        set(
                          "slots",
                          draft.slots.filter((s) => s.id !== slot.id),
                        )
                      }
                    >
                      <Trash className="size-4" />
                    </button>
                  </div>
                  <input
                    className="input mt-2"
                    placeholder="Room (optional)"
                    value={slot.room ?? ""}
                    onChange={(e) => updateSlot(slot.id, { room: e.target.value })}
                  />
                  {errors[slot.id] && <p className="mt-1 text-xs text-rose-500">{errors[slot.id]}</p>}
                </div>
              ))}
              <button type="button" className="btn-ghost border border-dashed border-indigo-300 dark:border-indigo-500/40" onClick={addSlot}>
                <Plus className="size-4" /> Add class time
              </button>
            </div>
          </div>

          <div className="rounded-2xl bg-zinc-50 p-3 dark:bg-zinc-800/50">
            <label className="flex items-center justify-between gap-3">
              <span>
                <span className="block text-sm font-medium">Custom threshold</span>
                <span className="block text-xs text-zinc-500">Default is {settings.threshold}% (change in Settings)</span>
              </span>
              <input
                type="checkbox"
                className="size-5 accent-indigo-600"
                checked={customThreshold}
                onChange={(e) => {
                  setCustomThreshold(e.target.checked);
                  if (e.target.checked && draft.threshold == null) set("threshold", settings.threshold);
                }}
              />
            </label>
            {customThreshold && (
              <div className="mt-3 flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  className="flex-1 accent-indigo-600"
                  value={draft.threshold ?? settings.threshold}
                  onChange={(e) => set("threshold", Number(e.target.value))}
                />
                <span className="w-12 text-right text-sm font-semibold tabular-nums">{draft.threshold}%</span>
              </div>
            )}
            {errors.threshold && <p className="mt-1 text-xs text-rose-500">{errors.threshold}</p>}
          </div>
        </div>
      </Sheet>

      <ConfirmSheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete course?"
        message={
          <>
            <strong>{course?.title}</strong> and all of its attendance history will be permanently deleted.
          </>
        }
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          if (course?.id == null) return;
          await deleteCourse(course.id);
          toast({ title: "Course deleted" });
          onClose();
        }}
      />
    </>
  );
}
