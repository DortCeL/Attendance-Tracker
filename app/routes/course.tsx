import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, Minus, Pencil, Plus, Trash, User } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import CourseForm from "~/components/CourseForm";
import PageHeader, { EmptyState } from "~/components/PageHeader";
import { PercentRing } from "~/components/Progress";
import { ConfirmSheet } from "~/components/Sheet";
import { db, deleteRecord, setAttendance } from "~/database/db";
import { formatDateShort, formatTime, parseISODate } from "~/lib/date";
import { useSettings } from "~/lib/hooks";
import { RISK_STYLES, computeStats, effectiveThreshold, formatPercent, riskMessage } from "~/lib/stats";
import type { AttendanceRecord, AttendanceStatus } from "~/lib/types";

export function meta() {
  return [{ title: "Course · Attendance Tracker" }];
}

const STATUS_STYLES: Record<AttendanceStatus, string> = {
  attended: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  missed: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",
  cancelled: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export default function CourseDetail() {
  const { id } = useParams();
  const courseId = Number(id);
  const navigate = useNavigate();
  const settings = useSettings();
  const course = useLiveQuery(() => db.courses.get(courseId), [courseId], null);
  const records = useLiveQuery(() => db.records.where("courseId").equals(courseId).toArray(), [courseId]);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [planAttend, setPlanAttend] = useState(0);
  const [planMiss, setPlanMiss] = useState(0);

  const stats = useMemo(
    () => (course && records ? computeStats(records, effectiveThreshold(course, settings), settings.warnMargin) : null),
    [course, records, settings],
  );

  const grouped = useMemo(() => {
    if (!records) return [];
    const sorted = [...records].sort((a, b) => b.date.localeCompare(a.date) || (b.start ?? "").localeCompare(a.start ?? ""));
    const groups = new Map<string, AttendanceRecord[]>();
    for (const r of sorted) {
      const key = parseISODate(r.date).toLocaleDateString(undefined, { month: "long", year: "numeric" });
      const g = groups.get(key);
      if (g) g.push(r);
      else groups.set(key, [r]);
    }
    return [...groups.entries()];
  }, [records]);

  if (course === undefined) {
    return (
      <>
        <PageHeader title="Course not found" subtitle="It may have been deleted." />
        <div className="px-5">
          <Link to="/stats" className="btn-primary">
            Back to stats
          </Link>
        </div>
      </>
    );
  }
  if (!course || !stats) return null;

  const projected =
    planAttend + planMiss > 0 ? ((stats.attended + planAttend) / (stats.held + planAttend + planMiss)) * 100 : null;
  const projectedRisk = projected === null ? null : projected < stats.threshold ? "danger" : projected < stats.threshold + settings.warnMargin ? "warning" : "safe";

  return (
    <>
      <PageHeader
        title={course.title}
        subtitle={
          <span className="flex items-center gap-2">
            {course.code && <span>{course.code}</span>}
            {course.lecturer && (
              <span className="inline-flex items-center gap-1">
                <User className="size-3" /> {course.lecturer}
              </span>
            )}
          </span>
        }
        leading={
          <button className="icon-btn -ml-2" aria-label="Back" onClick={() => (history.length > 1 ? navigate(-1) : navigate("/stats"))}>
            <ArrowLeft className="size-5" />
          </button>
        }
        action={
          <button className="icon-btn" aria-label="Edit course" onClick={() => setEditOpen(true)}>
            <Pencil className="size-4" />
          </button>
        }
      />

      <div className="flex flex-col gap-4 px-5">
        <section className="card p-5">
          <div className="flex items-center gap-5">
            <PercentRing percent={stats.percent} threshold={stats.threshold} risk={stats.risk} size={112} stroke={10} label={`min ${stats.threshold}%`} />
            <div className="min-w-0 flex-1">
              <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${RISK_STYLES[stats.risk].bg} ${RISK_STYLES[stats.risk].text}`}>
                {RISK_STYLES[stats.risk].label}
              </span>
              <p className="mt-2 text-sm font-medium">{riskMessage(stats)}</p>
              {stats.held > 0 && (
                <p className="mt-1 text-xs text-zinc-500">
                  Next class: miss → {stats.ifMissNext.toFixed(1)}% · attend → {stats.ifAttendNext.toFixed(1)}%
                </p>
              )}
            </div>
          </div>
          <div className="mt-5 grid grid-cols-4 gap-2 border-t border-zinc-100 pt-4 text-center dark:border-zinc-800">
            <Count value={stats.attended} label="Attended" className="text-emerald-600 dark:text-emerald-400" />
            <Count value={stats.missed} label="Missed" className="text-rose-600 dark:text-rose-400" />
            <Count value={stats.cancelled} label="Cancelled" className="text-zinc-500" />
            <Count value={stats.held} label="Held" />
          </div>
        </section>

        <section className="card p-4">
          <h2 className="text-sm font-semibold">What if…</h2>
          <p className="mt-0.5 text-xs text-zinc-500">Plan the next few classes and see where you'd land.</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Stepper label="Attend" value={planAttend} onChange={setPlanAttend} />
            <Stepper label="Miss" value={planMiss} onChange={setPlanMiss} />
          </div>
          <div className="mt-3 flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3 dark:bg-zinc-800/50">
            <span className="text-sm text-zinc-500">Projected</span>
            <span className={`text-lg font-bold tabular-nums ${projectedRisk ? RISK_STYLES[projectedRisk].text : "text-zinc-400"}`}>
              {projected === null ? "—" : formatPercent(projected, 1)}
            </span>
          </div>
        </section>

        <h2 className="section-title mt-2">History</h2>
        {grouped.length === 0 ? (
          <EmptyState icon={<User className="size-6" />} title="No classes marked yet" body="Mark classes from the Today tab and they'll show up here." />
        ) : (
          grouped.map(([month, items]) => (
            <section key={month} className="card overflow-hidden">
              <h3 className="border-b border-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-500 dark:border-zinc-800">{month}</h3>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {items.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Link to={`/?date=${r.date}`} className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{formatDateShort(r.date)}</span>
                      <span className="block text-xs text-zinc-500">
                        {r.start ? formatTime(r.start) : "—"}
                        {r.extra && " · Extra class"}
                      </span>
                    </Link>
                    <select
                      aria-label="Status"
                      value={r.status}
                      onChange={(e) =>
                        setAttendance({ courseId, date: r.date, slotId: r.slotId, status: e.target.value as AttendanceStatus })
                      }
                      className={`cursor-pointer appearance-none rounded-full border-0 px-3 py-1 text-center text-xs font-semibold capitalize outline-none ${STATUS_STYLES[r.status]}`}
                    >
                      <option value="attended">Attended</option>
                      <option value="missed">Missed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                    <button className="icon-btn -mr-2 hover:text-rose-600" aria-label="Delete record" onClick={() => setDeleteId(r.id!)}>
                      <Trash className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      <CourseForm
        open={editOpen}
        onClose={() => {
          setEditOpen(false);
          db.courses.get(courseId).then((c) => !c && navigate("/stats", { replace: true }));
        }}
        course={course}
        courseCount={0}
      />

      <ConfirmSheet
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        title="Delete this record?"
        message="The class will go back to unmarked (or be removed, if it was an extra class)."
        confirmLabel="Delete"
        danger
        onConfirm={() => deleteId != null && deleteRecord(deleteId)}
      />
    </>
  );
}

function Count({ value, label, className = "" }: { value: number; label: string; className?: string }) {
  return (
    <div>
      <p className={`text-lg font-bold tabular-nums ${className}`}>{value}</p>
      <p className="text-[10px] font-medium tracking-wide text-zinc-500 uppercase">{label}</p>
    </div>
  );
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-zinc-200 p-1.5 dark:border-zinc-700">
      <button className="icon-btn" aria-label={`Decrease ${label}`} onClick={() => onChange(Math.max(0, value - 1))}>
        <Minus className="size-4" />
      </button>
      <span className="text-center">
        <span className="block text-base font-bold tabular-nums">{value}</span>
        <span className="block text-[10px] text-zinc-500 uppercase">{label}</span>
      </span>
      <button className="icon-btn" aria-label={`Increase ${label}`} onClick={() => onChange(value + 1)}>
        <Plus className="size-4" />
      </button>
    </div>
  );
}
