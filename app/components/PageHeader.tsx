import type { ReactNode } from "react";

export default function PageHeader({
  title,
  subtitle,
  action,
  leading,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  leading?: ReactNode;
}) {
  return (
    <header className="flex items-center gap-3 px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-4">
      {leading}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-3xl border border-dashed border-zinc-300 px-6 py-10 text-center dark:border-zinc-700">
      <div className="mb-3 rounded-2xl bg-indigo-50 p-3 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">{icon}</div>
      <p className="font-semibold">{title}</p>
      {body && <p className="mt-1 max-w-xs text-sm text-zinc-500 dark:text-zinc-400">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
