import { Ban, Check, MapPin, Trash, X } from "lucide-react";
import { Link } from "react-router";
import { formatDateShort, formatTime, todayISO } from "~/lib/date";
import { useMarkAttendance } from "~/lib/hooks";
import type { DayEntry } from "~/lib/schedule";
import { RISK_STYLES, formatPercent, type CourseStats } from "~/lib/stats";
import type { AttendanceStatus } from "~/lib/types";

const OPTIONS: {
  status: AttendanceStatus;
  label: string;
  icon: typeof Check;
  active: string;
}[] = [
  { status: "attended", label: "Attended", icon: Check, active: "bg-emerald-500 text-white border-emerald-500 shadow-sm shadow-emerald-500/30" },
  { status: "missed", label: "Missed", icon: X, active: "bg-rose-500 text-white border-rose-500 shadow-sm shadow-rose-500/30" },
  { status: "cancelled", label: "Cancelled", icon: Ban, active: "bg-zinc-600 text-white border-zinc-600 dark:bg-zinc-500 dark:border-zinc-500" },
];

export default function ClassCard({
  entry,
  stats,
  showDate,
  onDeleteExtra,
}: {
  entry: DayEntry;
  stats?: CourseStats;
  showDate?: boolean;
  onDeleteExtra?: (recordId: number) => void;
}) {
  const mark = useMarkAttendance();
  const current = entry.record?.status;
  const isFuture = entry.date > todayISO();

  const onPick = (status: AttendanceStatus) => {
    // Extra classes exist only as a record, so they can't be un-marked — only deleted.
    const next = current === status && !entry.extra ? null : status;
    if (next === current) return;
    mark({
      course: entry.course,
      date: entry.date,
      slotId: entry.slotId,
      status: next,
      start: entry.start,
      end: entry.end,
    });
  };

  return (
    <article className="card relative overflow-hidden p-4 pl-5">
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: entry.course.color }} />
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link to={`/courses/${entry.course.id}`} className="block truncate font-semibold hover:underline">
            {entry.course.title}
          </Link>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            {showDate && <span className="font-medium text-zinc-700 dark:text-zinc-300">{formatDateShort(entry.date)} ·</span>}
            {entry.start ? (
              <span>
                {formatTime(entry.start)}
                {entry.end && ` – ${formatTime(entry.end)}`}
              </span>
            ) : (
              <span>No time set</span>
            )}
            {entry.room && (
              <span className="inline-flex items-center gap-0.5">
                · <MapPin className="size-3" />
                {entry.room}
              </span>
            )}
            {entry.extra && (
              <span className="rounded-md bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 uppercase dark:bg-indigo-500/15 dark:text-indigo-300">
                Extra
              </span>
            )}
            {entry.orphan && (
              <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold text-zinc-500 uppercase dark:bg-zinc-800">
                Removed from routine
              </span>
            )}
          </p>
        </div>
        {stats && (
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ${RISK_STYLES[stats.risk].bg} ${RISK_STYLES[stats.risk].text}`}>
            {formatPercent(stats.percent)}
          </span>
        )}
        {entry.extra && onDeleteExtra && entry.record?.id != null && (
          <button className="icon-btn -mt-1 -mr-2 shrink-0 hover:text-rose-600" aria-label="Delete extra class" onClick={() => onDeleteExtra(entry.record!.id!)}>
            <Trash className="size-4" />
          </button>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {OPTIONS.map(({ status, label, icon: Icon, active }) => {
          const selected = current === status;
          const disabled = isFuture && status !== "cancelled";
          return (
            <button
              key={status}
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => onPick(status)}
              className={`flex items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-semibold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 ${
                selected
                  ? active
                  : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              <Icon className="size-4" strokeWidth={2.5} />
              {label}
            </button>
          );
        })}
      </div>
    </article>
  );
}
