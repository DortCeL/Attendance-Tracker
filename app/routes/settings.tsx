import { Bell, Download, Monitor, Moon, RotateCcw, ShieldCheck, Smartphone, Sun, Trash, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import PageHeader from "~/components/PageHeader";
import { ConfirmSheet } from "~/components/Sheet";
import { useToast } from "~/components/Toast";
import { clearAttendance, exportData, importData, resetAll, updateSettings } from "~/database/db";
import { DAY_LONG, todayISO } from "~/lib/date";
import { useSettings } from "~/lib/hooks";
import { isIOS, isStandalone, useInstallPrompt } from "~/lib/install";
import { notificationsSupported, requestNotificationPermission } from "~/lib/notify";
import type { Theme, Weekday } from "~/lib/types";

export function meta() {
  return [{ title: "Settings · Attendance Tracker" }];
}

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "Auto", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

export default function Settings() {
  const settings = useSettings();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirm, setConfirm] = useState<"clear" | "reset" | null>(null);
  const [pendingImport, setPendingImport] = useState<unknown>(null);
  const { canInstall, install } = useInstallPrompt();
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);

  // Local slider state so dragging doesn't write to IndexedDB on every pixel.
  const [threshold, setThreshold] = useState(settings.threshold);
  const [margin, setMargin] = useState(settings.warnMargin);
  useEffect(() => setThreshold(settings.threshold), [settings.threshold]);
  useEffect(() => setMargin(settings.warnMargin), [settings.warnMargin]);

  useEffect(() => {
    setStandalone(isStandalone());
    setIos(isIOS());
  }, []);

  const toggleNotifications = async (on: boolean) => {
    if (on && !(await requestNotificationPermission())) {
      toast({ title: "Notifications blocked", body: "Allow notifications for this site in your browser settings.", tone: "warning" });
      return;
    }
    await updateSettings({ notifications: on });
  };

  const handleExport = async () => {
    const data = await exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-backup-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Backup downloaded", tone: "success" });
  };

  const handleFile = async (file: File) => {
    try {
      setPendingImport(JSON.parse(await file.text()));
    } catch {
      toast({ title: "Couldn't read that file", body: "Make sure it's a JSON backup from this app.", tone: "danger" });
    }
  };

  return (
    <>
      <PageHeader title="Settings" />

      <div className="flex flex-col gap-6 px-5">
        <Group title="Attendance">
          <Row
            title="Minimum attendance"
            description="Courses below this are flagged red. You can override it per course."
            control={<span className="text-lg font-bold text-indigo-600 tabular-nums dark:text-indigo-400">{threshold}%</span>}
          >
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={threshold}
              aria-label="Minimum attendance"
              className="mt-3 w-full accent-indigo-600"
              onChange={(e) => setThreshold(Number(e.target.value))}
              onPointerUp={() => updateSettings({ threshold })}
              onKeyUp={() => updateSettings({ threshold })}
              onBlur={() => updateSettings({ threshold })}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[50, 60, 70, 75, 80, 85].map((v) => (
                <button
                  key={v}
                  onClick={() => updateSettings({ threshold: v })}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    settings.threshold === v ? "bg-indigo-600 text-white" : "bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                  }`}
                >
                  {v}%
                </button>
              ))}
            </div>
          </Row>

          <Row
            title="Warning zone"
            description={`Warn when a course drops below ${threshold + margin}%, or when missing one more class would put it under ${threshold}%.`}
            control={<span className="text-lg font-bold text-amber-600 tabular-nums dark:text-amber-400">+{margin}%</span>}
          >
            <input
              type="range"
              min={0}
              max={25}
              step={1}
              value={margin}
              aria-label="Warning zone"
              className="mt-3 w-full accent-amber-500"
              onChange={(e) => setMargin(Number(e.target.value))}
              onPointerUp={() => updateSettings({ warnMargin: margin })}
              onKeyUp={() => updateSettings({ warnMargin: margin })}
              onBlur={() => updateSettings({ warnMargin: margin })}
            />
          </Row>

          <Row
            title="Term start date"
            description="Classes from this date on are tracked. Unmarked past classes show up as a to-do list."
            control={
              <div className="flex items-center gap-1">
                <input
                  type="date"
                  className="input w-auto px-2 py-1.5"
                  value={settings.termStart ?? ""}
                  max={todayISO()}
                  onChange={(e) => updateSettings({ termStart: e.target.value || null })}
                />
              </div>
            }
          >
            {settings.termStart && (
              <button className="mt-1 text-xs font-medium text-indigo-600 dark:text-indigo-400" onClick={() => updateSettings({ termStart: null })}>
                Clear (track from when each course was added)
              </button>
            )}
          </Row>
        </Group>

        <Group title="Calendar & appearance">
          <Row
            title="Week starts on"
            control={
              <select
                className="input w-auto py-1.5"
                value={settings.weekStart}
                onChange={(e) => updateSettings({ weekStart: Number(e.target.value) as Weekday })}
              >
                {[6, 0, 1].map((d) => (
                  <option key={d} value={d}>
                    {DAY_LONG[d]}
                  </option>
                ))}
              </select>
            }
          />
          <Row title="Theme">
            <div className="mt-3 grid grid-cols-3 gap-2">
              {THEMES.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => updateSettings({ theme: value })}
                  className={`flex flex-col items-center gap-1 rounded-2xl border py-3 text-xs font-semibold transition ${
                    settings.theme === value
                      ? "border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                      : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  }`}
                >
                  <Icon className="size-5" />
                  {label}
                </button>
              ))}
            </div>
          </Row>
        </Group>

        <Group title="App">
          <Row
            icon={<Bell className="size-5" />}
            title="Low-attendance notifications"
            description={
              notificationsSupported()
                ? "Get a system notification when marking a class missed puts a course at risk."
                : "Not supported in this browser. Install the app to enable."
            }
            control={
              <Toggle checked={settings.notifications} disabled={!notificationsSupported()} onChange={toggleNotifications} label="Notifications" />
            }
          />
          <Row
            icon={<Smartphone className="size-5" />}
            title={standalone ? "Installed" : "Install app"}
            description={
              standalone
                ? "You're using the installed app. It works offline."
                : canInstall
                  ? "Add it to your home screen for quick access and offline use."
                  : ios
                    ? "In Safari, tap Share → Add to Home Screen."
                    : "Use your browser menu → Install app / Add to Home screen."
            }
            control={
              canInstall && !standalone ? (
                <button className="btn-primary px-3 py-1.5" onClick={install}>
                  Install
                </button>
              ) : undefined
            }
          />
        </Group>

        <Group title="Your data">
          <Row
            icon={<ShieldCheck className="size-5" />}
            title="Stored on this device"
            description="Nothing is uploaded anywhere. Export a backup to move to another phone or keep it safe."
          />
          <div className="grid grid-cols-2 gap-2 p-4 pt-0">
            <button className="btn-secondary" onClick={handleExport}>
              <Download className="size-4" /> Export
            </button>
            <button className="btn-secondary" onClick={() => fileInput.current?.click()}>
              <Upload className="size-4" /> Import
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 border-t border-zinc-100 p-4 dark:border-zinc-800">
            <button className="btn-secondary text-rose-600 dark:text-rose-400" onClick={() => setConfirm("clear")}>
              <RotateCcw className="size-4" /> Clear marks
            </button>
            <button className="btn-secondary text-rose-600 dark:text-rose-400" onClick={() => setConfirm("reset")}>
              <Trash className="size-4" /> Reset all
            </button>
          </div>
        </Group>

        <p className="pb-4 text-center text-xs text-zinc-400">Attendance Tracker · works offline</p>
      </div>

      <ConfirmSheet
        open={confirm === "clear"}
        onClose={() => setConfirm(null)}
        title="Clear all attendance?"
        message="Every attended / missed / cancelled mark and extra class is deleted. Your courses and routine stay."
        confirmLabel="Clear marks"
        danger
        onConfirm={async () => {
          await clearAttendance();
          toast({ title: "Attendance cleared" });
        }}
      />
      <ConfirmSheet
        open={confirm === "reset"}
        onClose={() => setConfirm(null)}
        title="Reset everything?"
        message="All courses, attendance and settings are permanently deleted. Consider exporting a backup first."
        confirmLabel="Reset"
        danger
        onConfirm={async () => {
          await resetAll();
          toast({ title: "All data reset" });
        }}
      />
      <ConfirmSheet
        open={pendingImport !== null}
        onClose={() => setPendingImport(null)}
        title="Restore this backup?"
        message="Your current courses, attendance and settings will be replaced by the backup."
        confirmLabel="Restore"
        onConfirm={async () => {
          try {
            await importData(pendingImport);
            toast({ title: "Backup restored", tone: "success" });
          } catch (err) {
            toast({ title: "Import failed", body: err instanceof Error ? err.message : String(err), tone: "danger" });
          }
        }}
      />
    </>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="section-title">{title}</h2>
      <div className="card divide-y divide-zinc-100 overflow-hidden dark:divide-zinc-800">{children}</div>
    </section>
  );
}

function Row({
  title,
  description,
  control,
  icon,
  children,
}: {
  title: string;
  description?: ReactNode;
  control?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="p-4">
      <div className="flex items-center gap-3">
        {icon && <span className="shrink-0 text-zinc-400">{icon}</span>}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          {description && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{description}</p>}
        </div>
        {control && <div className="shrink-0">{control}</div>}
      </div>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 rounded-full transition disabled:opacity-40 ${checked ? "bg-indigo-600" : "bg-zinc-300 dark:bg-zinc-700"}`}
    >
      <span className={`absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
    </button>
  );
}
