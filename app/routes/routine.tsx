import { BookOpen, Clock, MapPin, Pencil, Plus, User } from "lucide-react";
import { useState } from "react";
import CourseForm from "~/components/CourseForm";
import PageHeader, { EmptyState } from "~/components/PageHeader";
import { DAY_LONG, formatTime, orderedWeekdays, todayISO, weekdayOf } from "~/lib/date";
import { useCourses, useSettings } from "~/lib/hooks";
import type { Course, Slot } from "~/lib/types";

export function meta() {
  return [{ title: "Routine · Attendance Tracker" }];
}

type View = "week" | "courses";

export default function Routine() {
  const courses = useCourses();
  const settings = useSettings();
  const [view, setView] = useState<View>("week");
  const [editing, setEditing] = useState<Course | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (c: Course) => {
    setEditing(c);
    setFormOpen(true);
  };

  const today = weekdayOf(todayISO());
  const totalSlots = courses?.reduce((n, c) => n + c.slots.length, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Routine"
        subtitle={courses ? `${courses.length} course${courses.length === 1 ? "" : "s"} · ${totalSlots} classes a week` : " "}
        action={
          <button className="btn-primary px-3" onClick={openNew}>
            <Plus className="size-4" /> Course
          </button>
        }
      />

      <div className="px-5">
        {courses && courses.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="size-6" />}
            title="Build your weekly routine"
            body="Add each course with its weekly class times."
            action={
              <button className="btn-primary" onClick={openNew}>
                <Plus className="size-4" /> Add course
              </button>
            }
          />
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 rounded-2xl bg-zinc-200/60 p-1 dark:bg-zinc-800/80">
              {(["week", "courses"] as View[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`rounded-xl py-2 text-sm font-semibold capitalize transition ${
                    view === v ? "bg-white shadow-sm dark:bg-zinc-700" : "text-zinc-500"
                  }`}
                >
                  {v === "week" ? "Weekly view" : "Courses"}
                </button>
              ))}
            </div>

            {view === "week" ? (
              <div className="flex flex-col gap-3">
                {orderedWeekdays(settings.weekStart).map((day) => {
                  const items: { course: Course; slot: Slot }[] = (courses ?? [])
                    .flatMap((course) => course.slots.filter((s) => s.day === day).map((slot) => ({ course, slot })))
                    .sort((a, b) => a.slot.start.localeCompare(b.slot.start));
                  return (
                    <section key={day} className="card p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <h2 className="font-semibold">
                          {DAY_LONG[day]}
                          {day === today && (
                            <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700 uppercase dark:bg-indigo-500/15 dark:text-indigo-300">
                              Today
                            </span>
                          )}
                        </h2>
                        <span className="text-xs text-zinc-500">{items.length ? `${items.length} class${items.length > 1 ? "es" : ""}` : "Free"}</span>
                      </div>
                      {items.length > 0 && (
                        <ul className="flex flex-col gap-1.5">
                          {items.map(({ course, slot }) => (
                            <li key={slot.id}>
                              <button
                                onClick={() => openEdit(course)}
                                className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-800"
                              >
                                <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: course.color }} />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium">{course.title}</span>
                                  <span className="flex items-center gap-1 text-xs text-zinc-500">
                                    {formatTime(slot.start)} – {formatTime(slot.end)}
                                    {slot.room && <> · {slot.room}</>}
                                  </span>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  );
                })}
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {(courses ?? []).map((course) => (
                  <li key={course.id} className="card flex items-start gap-3 p-4">
                    <span className="mt-1 size-3 shrink-0 rounded-full" style={{ backgroundColor: course.color }} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {course.title}
                        {course.code && <span className="ml-2 text-xs font-medium text-zinc-500">{course.code}</span>}
                      </p>
                      {course.lecturer && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-zinc-500">
                          <User className="size-3" /> {course.lecturer}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {course.slots.length === 0 && <span className="text-xs text-amber-600 dark:text-amber-400">No class times yet — tap edit to add some</span>}
                        {[...course.slots]
                          .sort((a, b) => orderedWeekdays(settings.weekStart).indexOf(a.day) - orderedWeekdays(settings.weekStart).indexOf(b.day))
                          .map((s) => (
                            <span key={s.id} className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 px-2 py-1 text-[11px] font-medium dark:bg-zinc-800">
                              <Clock className="size-3" />
                              {DAY_LONG[s.day].slice(0, 3)} {formatTime(s.start)}
                              {s.room && (
                                <>
                                  <MapPin className="ml-1 size-3" />
                                  {s.room}
                                </>
                              )}
                            </span>
                          ))}
                      </div>
                      {course.threshold != null && <p className="mt-2 text-xs text-zinc-500">Custom threshold: {course.threshold}%</p>}
                    </div>
                    <button className="icon-btn" aria-label={`Edit ${course.title}`} onClick={() => openEdit(course)}>
                      <Pencil className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <CourseForm open={formOpen} onClose={() => setFormOpen(false)} course={editing} courseCount={courses?.length ?? 0} />
    </>
  );
}
