import { ChartNoAxesColumn, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import PageHeader, { EmptyState } from "~/components/PageHeader";
import { PercentRing, ThresholdBar } from "~/components/Progress";
import { useAllRecords, useCourses, useSettings } from "~/lib/hooks";
import { RISK_STYLES, computeStats, formatPercent, riskMessage, statsByCourse, type RiskLevel } from "~/lib/stats";

export function meta() {
  return [{ title: "Stats · Attendance Tracker" }];
}

const RISK_ORDER: Record<RiskLevel, number> = { danger: 0, warning: 1, safe: 2, none: 3 };

export default function Stats() {
  const courses = useCourses();
  const records = useAllRecords();
  const settings = useSettings();

  const stats = useMemo(
    () => (courses && records ? statsByCourse(courses, records, settings) : null),
    [courses, records, settings],
  );
  const overall = useMemo(
    () => (records ? computeStats(records, settings.threshold, settings.warnMargin) : null),
    [records, settings],
  );

  const sorted = useMemo(() => {
    if (!courses || !stats) return [];
    return [...courses].sort((a, b) => {
      const sa = stats.get(a.id!)!;
      const sb = stats.get(b.id!)!;
      return RISK_ORDER[sa.risk] - RISK_ORDER[sb.risk] || (sa.percent ?? 101) - sa.threshold - ((sb.percent ?? 101) - sb.threshold);
    });
  }, [courses, stats]);

  const counts = useMemo(() => {
    const c = { danger: 0, warning: 0, safe: 0, none: 0 };
    stats?.forEach((s) => c[s.risk]++);
    return c;
  }, [stats]);

  return (
    <>
      <PageHeader title="Stats" subtitle={`Default threshold ${settings.threshold}% · warns within ${settings.warnMargin}%`} />

      <div className="flex flex-col gap-4 px-5">
        {courses && courses.length === 0 ? (
          <EmptyState
            icon={<ChartNoAxesColumn className="size-6" />}
            title="No courses yet"
            body="Add courses in your routine and start marking classes to see stats here."
            action={
              <Link to="/routine" className="btn-primary">
                Go to routine
              </Link>
            }
          />
        ) : (
          <>
            {overall && (
              <section className="card flex items-center gap-5 p-5">
                <PercentRing percent={overall.percent} threshold={settings.threshold} risk={overall.risk} size={104} stroke={10} label="overall" />
                <div className="min-w-0 flex-1">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <Stat value={overall.attended} label="Attended" className="text-emerald-600 dark:text-emerald-400" />
                    <Stat value={overall.missed} label="Missed" className="text-rose-600 dark:text-rose-400" />
                    <Stat value={overall.cancelled} label="Cancelled" className="text-zinc-500" />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {counts.danger > 0 && <Pill risk="danger" text={`${counts.danger} below`} />}
                    {counts.warning > 0 && <Pill risk="warning" text={`${counts.warning} close`} />}
                    {counts.safe > 0 && <Pill risk="safe" text={`${counts.safe} safe`} />}
                  </div>
                </div>
              </section>
            )}

            <h2 className="section-title mt-2">Courses</h2>
            <ul className="flex flex-col gap-3">
              {sorted.map((course) => {
                const s = stats!.get(course.id!)!;
                return (
                  <li key={course.id}>
                    <Link to={`/courses/${course.id}`} className="card block p-4 transition hover:border-indigo-300 dark:hover:border-indigo-500/50">
                      <div className="flex items-center gap-3">
                        <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: course.color }} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">{course.title}</p>
                          <p className={`text-xs ${RISK_STYLES[s.risk].text}`}>{riskMessage(s)}</p>
                        </div>
                        <span className={`text-xl font-bold tabular-nums ${RISK_STYLES[s.risk].text}`}>{formatPercent(s.percent, 1)}</span>
                        <ChevronRight className="size-4 text-zinc-400" />
                      </div>
                      <div className="mt-3">
                        <ThresholdBar percent={s.percent} threshold={s.threshold} risk={s.risk} />
                      </div>
                      <div className="mt-2 flex justify-between text-[11px] text-zinc-500">
                        <span>
                          {s.attended} attended · {s.missed} missed · {s.cancelled} cancelled
                        </span>
                        <span>min {s.threshold}%</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </>
  );
}

function Stat({ value, label, className }: { value: number; label: string; className?: string }) {
  return (
    <div>
      <p className={`text-xl font-bold tabular-nums ${className}`}>{value}</p>
      <p className="text-[10px] font-medium tracking-wide text-zinc-500 uppercase">{label}</p>
    </div>
  );
}

function Pill({ risk, text }: { risk: RiskLevel; text: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${RISK_STYLES[risk].bg} ${RISK_STYLES[risk].text}`}>{text}</span>;
}
