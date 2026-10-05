import { CalendarCheck, CalendarDays, ChartNoAxesColumn, Settings } from "lucide-react";
import { NavLink } from "react-router";

const TABS = [
  { to: "/", label: "Today", icon: CalendarCheck, end: true },
  { to: "/stats", label: "Stats", icon: ChartNoAxesColumn, end: false },
  { to: "/routine", label: "Routine", icon: CalendarDays, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
];

export default function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200/80 bg-white/90 backdrop-blur-lg dark:border-zinc-800/80 dark:bg-zinc-950/90">
      <div className="mx-auto grid max-w-md grid-cols-4 px-2 pb-[env(safe-area-inset-bottom)]">
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
                isActive ? "text-indigo-600 dark:text-indigo-400" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={`rounded-full px-4 py-1 transition-colors ${isActive ? "bg-indigo-100 dark:bg-indigo-500/15" : ""}`}>
                  <Icon className="size-5" strokeWidth={isActive ? 2.4 : 2} />
                </span>
                {label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
