import { RISK_STYLES, formatPercent, type RiskLevel } from "~/lib/stats";

const RING_COLORS: Record<RiskLevel, string> = {
  none: "stroke-zinc-300 dark:stroke-zinc-700",
  safe: "stroke-emerald-500",
  warning: "stroke-amber-500",
  danger: "stroke-rose-500",
};

export function PercentRing({
  percent,
  threshold,
  risk,
  size = 64,
  stroke = 6,
  label,
}: {
  percent: number | null;
  threshold: number;
  risk: RiskLevel;
  size?: number;
  stroke?: number;
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const value = Math.max(0, Math.min(100, percent ?? 0));
  const angle = (threshold / 100) * 360 - 90;
  const rad = (angle * Math.PI) / 180;
  const cx = size / 2 + r * Math.cos(rad);
  const cy = size / 2 + r * Math.sin(rad);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-zinc-100 dark:stroke-zinc-800" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (value / 100) * c}
          className={`${RING_COLORS[risk]} transition-[stroke-dashoffset] duration-500`}
        />
      </svg>
      {threshold > 0 && threshold < 100 && (
        <svg width={size} height={size} className="pointer-events-none absolute inset-0">
          <circle cx={cx} cy={cy} r={stroke / 2.5} className="fill-zinc-900 dark:fill-white" />
        </svg>
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-bold tabular-nums ${size >= 100 ? "text-2xl" : "text-sm"} ${RISK_STYLES[risk].text}`}>
          {formatPercent(percent)}
        </span>
        {label && <span className="text-[10px] text-zinc-500">{label}</span>}
      </div>
    </div>
  );
}

export function ThresholdBar({ percent, threshold, risk }: { percent: number | null; threshold: number; risk: RiskLevel }) {
  return (
    <div className="relative h-2 w-full overflow-visible rounded-full bg-zinc-100 dark:bg-zinc-800">
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${RISK_STYLES[risk].bar}`}
        style={{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }}
      />
      <div
        className="absolute -top-1 h-4 w-0.5 rounded bg-zinc-900 dark:bg-white"
        style={{ left: `calc(${threshold}% - 1px)` }}
        title={`Threshold ${threshold}%`}
      />
    </div>
  );
}
