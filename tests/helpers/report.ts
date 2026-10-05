import { DAY_SHORT, parseISODate } from "~/lib/date";
import { riskMessage, type CourseStats, type RiskLevel } from "~/lib/stats";
import type { SimResult } from "./simulator";

const RISK_LABEL: Record<RiskLevel, string> = {
  none: "No data",
  safe: "Safe",
  warning: "Close call",
  danger: "BELOW",
};

const RISK_MARK: Record<RiskLevel, string> = { none: " ", safe: " ", warning: "~", danger: "!" };

const num = (n: number) => (n === Infinity ? "∞" : String(n));
const pct = (p: number | null, digits = 1) => (p === null ? "—" : `${p.toFixed(digits)}%`);
const day = (iso: string) => `${DAY_SHORT[parseISODate(iso).getDay()]} ${iso}`;

function bar(p: number | null, threshold: number, width = 20): string {
  if (p === null) return "·".repeat(width);
  const filled = Math.round((p / 100) * width);
  const mark = Math.min(width - 1, Math.round((threshold / 100) * width));
  let out = "";
  for (let i = 0; i < width; i++) out += i === mark ? "|" : i < filled ? "█" : "░";
  return out;
}

function titleOf(result: SimResult, code: string): string {
  return result.courses.find((c) => c.code === code)?.title ?? "";
}

/** Prints a human-readable semester report to the test output. */
export function printReport(result: SimResult) {
  const { scenario, settings } = result;
  const lines: string[] = [];
  const rule = "═".repeat(118);

  lines.push("", rule);
  lines.push(`  ${scenario.name}`);
  lines.push(`  ${scenario.summary}`);
  lines.push(
    `  ${day(scenario.termStart)} → ${day(result.endDate)} · ${scenario.weeks} weeks · ` +
      `threshold ${settings.threshold}% (warn within ${settings.warnMargin}) · ` +
      `${result.scheduledClasses} routine classes on the calendar`,
  );
  lines.push(rule);

  lines.push(
    "  " +
      "Course".padEnd(40) +
      "Att".padStart(4) +
      "Miss".padStart(5) +
      "Canc".padStart(5) +
      "Held".padStart(5) +
      "%".padStart(8) +
      "  " +
      "Progress (| = threshold)".padEnd(22) +
      "Skip".padStart(5) +
      "Need".padStart(5) +
      "  Status",
  );
  lines.push("  " + "─".repeat(116));

  let att = 0;
  let miss = 0;
  let canc = 0;
  for (const [code, s] of [...result.final].sort(([a], [b]) => a.localeCompare(b))) {
    att += s.attended;
    miss += s.missed;
    canc += s.cancelled;
    const override = s.threshold !== settings.threshold ? ` [${s.threshold}%]` : "";
    lines.push(
      "  " +
        (`${code}  ${titleOf(result, code)}`.slice(0, 39 - override.length) + override).padEnd(40) +
        String(s.attended).padStart(4) +
        String(s.missed).padStart(5) +
        String(s.cancelled).padStart(5) +
        String(s.held).padStart(5) +
        pct(s.percent).padStart(8) +
        "  " +
        bar(s.percent, s.threshold).padEnd(22) +
        num(s.canSkip).padStart(5) +
        (s.risk === "danger" ? num(s.needToAttend) : "–").padStart(5) +
        `  ${RISK_LABEL[s.risk].padEnd(10)} ${riskMessage(s)}`,
    );
  }
  lines.push("  " + "─".repeat(116));
  lines.push(
    "  " +
      "Overall".padEnd(40) +
      String(att).padStart(4) +
      String(miss).padStart(5) +
      String(canc).padStart(5) +
      String(att + miss).padStart(5) +
      pct(att + miss === 0 ? null : (att / (att + miss)) * 100).padStart(8),
  );

  lines.push("");
  lines.push("  Attendance % at the end of each week   (~ close call, ! below threshold, — nothing held yet)");
  const header = "  " + "Course".padEnd(10) + result.weekly.map((w) => `W${w.week}`.padStart(6)).join("");
  lines.push(header);
  for (const code of [...result.final.keys()].sort()) {
    const row = result.weekly.map((w) => {
      const s = w.stats.get(code);
      if (!s || s.percent === null) return "—".padStart(6);
      return `${s.percent.toFixed(0)}${RISK_MARK[s.risk]}`.padStart(6);
    });
    lines.push("  " + code.padEnd(10) + row.join(""));
  }

  if (result.alerts.length) {
    lines.push("");
    lines.push(`  Warnings the app showed (${result.alerts.length}):`);
    for (const a of result.alerts.slice(0, 12)) {
      lines.push(`    W${String(a.week).padStart(2)} ${day(a.date)}  [${a.alert.tone.padEnd(7)}] ${a.alert.title} — ${a.alert.body}`);
    }
    if (result.alerts.length > 12) lines.push(`    … and ${result.alerts.length - 12} more`);
  } else {
    lines.push("", "  Warnings the app showed: none");
  }

  if (result.backlog.length) {
    lines.push("", `  Unmarked classes in the backlog: ${result.backlog.length}`);
  }
  lines.push("");
  console.log(lines.join("\n"));
}

export function describeStats(s: CourseStats): string {
  return `${s.attended}/${s.held} = ${pct(s.percent)} (${s.risk})`;
}
