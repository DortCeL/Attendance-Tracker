import { CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type Tone = "info" | "success" | "warning" | "danger";

interface ToastItem {
  id: number;
  title: string;
  body?: string;
  tone: Tone;
  action?: { label: string; onClick: () => void };
}

type ShowToast = (t: Omit<ToastItem, "id" | "tone"> & { tone?: Tone; duration?: number }) => void;

const ToastContext = createContext<ShowToast>(() => {});

export const useToast = () => useContext(ToastContext);

const TONE_STYLES: Record<Tone, string> = {
  info: "text-indigo-500",
  success: "text-emerald-500",
  warning: "text-amber-500",
  danger: "text-rose-500",
};

const TONE_ICON: Record<Tone, typeof Info> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: TriangleAlert,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ShowToast>(
    ({ duration, tone = "info", ...t }) => {
      const id = nextId.current++;
      setItems((prev) => [...prev.slice(-2), { ...t, tone, id }]);
      setTimeout(() => dismiss(id), duration ?? (tone === "danger" || tone === "warning" ? 6000 : 3000));
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-50 mx-auto flex max-w-md flex-col gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        {items.map((t) => {
          const Icon = TONE_ICON[t.tone];
          return (
            <div
              key={t.id}
              role="status"
              className="animate-toast-in pointer-events-auto flex items-start gap-3 rounded-2xl border border-zinc-200 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95"
            >
              <Icon className={`mt-0.5 size-5 shrink-0 ${TONE_STYLES[t.tone]}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t.title}</p>
                {t.body && <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{t.body}</p>}
              </div>
              {t.action && (
                <button
                  className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-500/10"
                  onClick={() => {
                    t.action!.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
              <button
                aria-label="Dismiss"
                className="shrink-0 rounded-lg p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                onClick={() => dismiss(t.id)}
              >
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
