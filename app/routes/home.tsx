import { useLiveQuery } from "dexie-react-hooks";
import { Ban, CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight, ListChecks, Sparkles, TriangleAlert } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import ClassCard from "~/components/ClassCard";
import ExtraClassForm from "~/components/ExtraClassForm";
import PageHeader, { EmptyState } from "~/components/PageHeader";
import Sheet, { ConfirmSheet } from "~/components/Sheet";
import { useToast } from "~/components/Toast";
import { bulkSetAttendance, db, deleteRecord } from "~/database/db";
import { DAY_LONG, DAY_SHORT, addDays, formatDateLong, parseISODate, relativeDayLabel, todayISO, weekdayOf } from "~/lib/date";
import { useAllRecords, useCourses, useSettings } from "~/lib/hooks";
import { entriesForDate, unmarkedBefore, type DayEntry } from "~/lib/schedule";
import { RISK_STYLES, formatPercent, riskMessage, statsByCourse, type CourseStats } from "~/lib/stats";
import type { AttendanceStatus } from "~/lib/types";

export function meta() {
  return [{ title: "Today · Attendance Tracker" }];
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function Home() {
  const [params, setParams] = useSearchParams();
  const today = todayISO();
  const rawDate = params.get("date");
  const date = rawDate && ISO_RE.test(rawDate) ? rawDate : today;

  const courses = useCourses();
  const settings = useSettings();
  const allRecords = useAllRecords();
  const recordsOnDate = useLiveQuery(() => db.records.where("date").equals(date).toArray(), [date]);
  const toast = useToast();

  const [extraOpen, setExtraOpen] = useState(false);
  const [backlogOpen, setBacklogOpen] = useState(false);
  const [bulk, setBulk] = useState<AttendanceStatus | null>(null);
  const [deleteExtraId, setDeleteExtraId] = useState<number | null>(null);
  const dateInput = useRef<HTMLInputElement>(null);

  const goTo = (d: string) => setParams(d === today ? {} : { date: d }, { replace: true });

  const stats = useMemo(
    () => (courses && allRecords ? statsByCourse(courses, allRecords, settings) : new Map<number, CourseStats>()),
    [courses, allRecords, settings],
  );

  const entries = useMemo(
    () => (courses && recordsOnDate ? entriesForDate(date, courses, recordsOnDate, settings) : []),
    [date, courses, recordsOnDate, settings],
  );

  const backlog = useMemo(
    () => (courses && allRecords ? unmarkedBefore(courses, allRecords, settings, today) : []),
    [courses, allRecords, settings, today],
  );

  const atRisk = useMemo(
    () =>
      (courses ?? [])
        .map((c) => ({ course: c, s: stats.get(c.id!)! }))
        .filter(({ s }) => s && (s.risk === "danger" || s.risk === "warning"))
        .sort((a, b) => (a.s.percent ?? 0) - a.s.threshold - ((b.s.percent ?? 0) - b.s.threshold)),
    [courses, stats],
  );

  // Week strip
  const weekStartDate = addDays(date, -((weekdayOf(date) - settings.weekStart + 7) % 7));
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStartDate, i));
  const weekInfo = useMemo(() => {
    if (!courses || !allRecords) return new Map<string, { total: number; unmarked: number }>();
    const map = new Map<string, { total: number; unmarked: number }>();
    for (const d of week) {
      const e = entriesForDate(
        d,
        courses,
        allRecords.filter((r) => r.date === d),
        settings,
      );
      map.set(d, { total: e.length, unmarked: e.filter((x) => !x.record).length });
    }
    return map;
  }, [weekStartDate, courses, allRecords, settings]);

  const marked = entries.filter((e) => e.record).length;
  const unmarkedToday = entries.filter((e) => !e.record);
  const isFuture = date > today;
  const relative = relativeDayLabel(date);

  const applyBulk = async (status: AttendanceStatus) => {
    const targets = status === "cancelled" ? entries.filter((e) => !e.extra) : unmarkedToday;
    await bulkSetAttendance(
      targets.map((e) => ({ courseId: e.course.id!, date: e.date, slotId: e.slotId, start: e.start, end: e.end })),
      status,
    );
    toast({
      title: status === "cancelled" ? "All classes marked cancelled" : `${targets.length} class${targets.length === 1 ? "" : "es"} marked attended`,
      tone: "success",
    });
  };

  if (courses && courses.length === 0) {
    return (
      <>
        <PageHeader title="Attendance" subtitle={formatDateLong(today)} />
        <div className="px-5">
          <EmptyState
            icon={<Sparkles className="size-6" />}
            title="Welcome! Let's set up your routine"
            body="Add your courses and their weekly class times. Then each day you can mark classes as attended, missed or cancelled, and track your percentage."
            action={
              <Link to="/routine" className="btn-primary">
                <CalendarDays className="size-4" /> Set up routine
              </Link>
            }
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={relative ?? DAY_LONG[weekdayOf(date)]}
        subtitle={formatDateLong(date)}
        action={
          <div className="flex items-center gap-1">
            {date !== today && (
              <button className="btn-ghost px-3 py-1.5" onClick={() => goTo(today)}>
                Today
              </button>
            )}
            <div className="relative">
              <button
                className="icon-btn"
                aria-label="Pick a date"
                onClick={() => {
                  const el = dateInput.current;
                  if (!el) return;
                  if ("showPicker" in el) el.showPicker();
                  else (el as HTMLInputElement).click();
                }}
              >
                <CalendarDays className="size-5" />
              </button>
              <input
                ref={dateInput}
                type="date"
                tabIndex={-1}
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-0"
                value={date}
                onChange={(e) => e.target.value && goTo(e.target.value)}
              />
            </div>
          </div>
        }
      />

      {/* Week strip */}
      <div className="flex items-center gap-1 px-3">
        <button className="icon-btn shrink-0" aria-label="Previous week" onClick={() => goTo(addDays(date, -7))}>
          <ChevronLeft className="size-5" />
        </button>
        <div className="grid flex-1 grid-cols-7 gap-1">
          {week.map((d) => {
            const info = weekInfo.get(d);
            const selected = d === date;
            const dot =
              !info || info.total === 0
                ? ""
                : d > today
                  ? "bg-zinc-300 dark:bg-zinc-600"
                  : info.unmarked === 0
                    ? "bg-emerald-500"
                    : d < today
                      ? "bg-amber-500"
                      : "bg-indigo-500";
            return (
              <button
                key={d}
                onClick={() => goTo(d)}
                className={`flex flex-col items-center gap-0.5 rounded-2xl py-2 transition ${
                  selected
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/25"
                    : d === today
                      ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                      : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                <span className={`text-[10px] font-medium uppercase ${selected ? "text-indigo-100" : "text-zinc-500"}`}>{DAY_SHORT[weekdayOf(d)]}</span>
                <span className="text-base font-semibold tabular-nums">{parseISODate(d).getDate()}</span>
                <span className={`size-1.5 rounded-full ${selected && dot ? "bg-white" : dot}`} />
              </button>
            );
          })}
        </div>
        <button className="icon-btn shrink-0" aria-label="Next week" onClick={() => goTo(addDays(date, 7))}>
          <ChevronRight className="size-5" />
        </button>
      </div>

      <div className="mt-5 flex flex-col gap-4 px-5">
        {/* Backlog */}
        {backlog.length > 0 && (
          <button
            onClick={() => setBacklogOpen(true)}
            className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-left transition hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-500/10 dark:hover:bg-amber-500/15"
          >
            <ListChecks className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="flex-1 text-sm">
              <strong>
                {backlog.length} unmarked class{backlog.length === 1 ? "" : "es"}
              </strong>{" "}
              from earlier days
            </span>
            <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">Review</span>
          </button>
        )}

        {/* At-risk courses */}
        {atRisk.length > 0 && (
          <section className="card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
              <TriangleAlert className="size-4 text-amber-500" />
              <h2 className="text-sm font-semibold">Attendance alerts</h2>
            </div>
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {atRisk.map(({ course, s }) => (
                <li key={course.id}>
                  <Link to={`/courses/${course.id}`} className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: course.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{course.title}</span>
                      <span className="block text-xs text-zinc-500">{riskMessage(s)}</span>
                    </span>
                    <span className={`text-sm font-bold tabular-nums ${RISK_STYLES[s.risk].text}`}>{formatPercent(s.percent, 1)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Day header */}
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
            {entries.length === 0 ? "No classes" : `${marked}/${entries.length} marked`}
          </h2>
          {entries.length > 0 && (
            <div className="flex gap-1">
              {!isFuture && unmarkedToday.length > 0 && (
                <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setBulk("attended")}>
                  <Check className="size-3.5" /> All attended
                </button>
              )}
              <button className="btn-ghost px-2.5 py-1.5 text-xs text-zinc-600 dark:text-zinc-400" onClick={() => setBulk("cancelled")}>
                <Ban className="size-3.5" /> Holiday
              </button>
            </div>
          )}
        </div>

        {entries.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="size-6" />}
            title={settings.termStart && date < settings.termStart ? "Before term start" : "Free day!"}
            body="Nothing on your routine for this day. Had a makeup class? Add it below."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {entries.map((e) => (
              <ClassCard key={e.key} entry={e} stats={stats.get(e.course.id!)} onDeleteExtra={setDeleteExtraId} />
            ))}
          </div>
        )}

        <button className="btn-secondary" onClick={() => setExtraOpen(true)}>
          <CalendarPlus className="size-4" /> Add extra class
        </button>
      </div>

      <ExtraClassForm open={extraOpen} onClose={() => setExtraOpen(false)} date={date} courses={courses ?? []} />

      <BacklogSheet open={backlogOpen} onClose={() => setBacklogOpen(false)} entries={backlog} stats={stats} />

      <ConfirmSheet
        open={bulk !== null}
        onClose={() => setBulk(null)}
        title={bulk === "cancelled" ? "Mark the whole day as cancelled?" : "Mark all as attended?"}
        message={
          bulk === "cancelled"
            ? "Every scheduled class on this day will be marked cancelled. Cancelled classes don't affect your percentage."
            : `${unmarkedToday.length} unmarked class${unmarkedToday.length === 1 ? "" : "es"} will be marked attended.`
        }
        confirmLabel={bulk === "cancelled" ? "Mark cancelled" : "Mark attended"}
        onConfirm={() => bulk && applyBulk(bulk)}
      />

      <ConfirmSheet
        open={deleteExtraId !== null}
        onClose={() => setDeleteExtraId(null)}
        title="Delete extra class?"
        message="This removes the class and its attendance record."
        confirmLabel="Delete"
        danger
        onConfirm={() => deleteExtraId != null && deleteRecord(deleteExtraId)}
      />
    </>
  );
}

function BacklogSheet({
  open,
  onClose,
  entries,
  stats,
}: {
  open: boolean;
  onClose: () => void;
  entries: DayEntry[];
  stats: Map<number, CourseStats>;
}) {
  const [confirm, setConfirm] = useState(false);
  const toast = useToast();

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title="Unmarked classes"
        footer={
          entries.length > 0 ? (
            <button className="btn-secondary w-full" onClick={() => setConfirm(true)}>
              <Check className="size-4" /> Mark all {entries.length} as attended
            </button>
          ) : undefined
        }
      >
        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">All caught up!</p>
        ) : (
          <div className="flex flex-col gap-3">
            {entries.slice(0, 60).map((e) => (
              <ClassCard key={e.key} entry={e} stats={stats.get(e.course.id!)} showDate />
            ))}
            {entries.length > 60 && <p className="text-center text-xs text-zinc-500">Showing the 60 most recent.</p>}
          </div>
        )}
      </Sheet>
      <ConfirmSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Mark all as attended?"
        message={`${entries.length} past classes will be marked attended. You can still change any of them later.`}
        confirmLabel="Mark attended"
        onConfirm={async () => {
          await bulkSetAttendance(
            entries.map((e) => ({ courseId: e.course.id!, date: e.date, slotId: e.slotId, start: e.start, end: e.end })),
            "attended",
          );
          toast({ title: "Backlog cleared", tone: "success" });
          onClose();
        }}
      />
    </>
  );
}
