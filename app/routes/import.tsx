import { ArrowLeft, ArrowRight, Camera, Check, Highlighter, ImagePlus, Plus, RotateCcw, ScanText, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import PageHeader from "~/components/PageHeader";
import { useToast } from "~/components/Toast";
import { importCourses } from "~/database/db";
import { DAY_SHORT, formatTime, orderedWeekdays } from "~/lib/date";
import { useCourses, useSettings } from "~/lib/hooks";
import { prepareImage, type PreparedImage } from "~/lib/image";
import type { Progress, ReadCourse } from "~/lib/routine-ocr";
import type { Course, Slot, Weekday } from "~/lib/types";
import { uid } from "~/lib/uid";

export function meta() {
  return [{ title: "Import routine · Attendance Tracker" }];
}

interface Draft {
  key: string;
  selected: boolean;
  /** The course ID exactly as written in the routine. */
  code: string;
  lecturer: string;
  group: string;
  slots: Slot[];
  existingId?: number;
}

type Card = { kind: "single"; key: string } | { kind: "groups"; code: string; keys: string[] };

type Stage = "pick" | "reading" | "review" | "names";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function findExisting(courses: Course[], code: string): Course | undefined {
  const id = norm(code);
  return courses.find((c) => (c.code && norm(c.code) === id) || norm(c.title) === id);
}

function slotError(s: Slot): string | null {
  if (!s.start || !s.end) return "Set both times";
  if (s.end <= s.start) return "End must be after start";
  return null;
}

const slotSummary = (slots: Slot[]) => slots.map((s) => `${DAY_SHORT[s.day]} ${formatTime(s.start)}`).join(" · ");

/** Courses split into several groups get one card with a group picker; everything else is a plain card. */
function buildCards(drafts: Draft[]): Card[] {
  const variants = new Map<string, string[]>();
  for (const d of drafts) {
    if (!d.group || !d.code) continue;
    variants.set(d.code, [...(variants.get(d.code) ?? []), d.key]);
  }
  const cards: Card[] = [];
  const seen = new Set<string>();
  for (const d of drafts) {
    const keys = d.group && d.code ? variants.get(d.code)! : null;
    if (keys && keys.length > 1) {
      if (seen.has(d.code)) continue;
      seen.add(d.code);
      cards.push({ kind: "groups", code: d.code, keys });
    } else {
      cards.push({ kind: "single", key: d.key });
    }
  }
  return cards;
}

function initialDrafts(read: ReadCourse[], highlighted: boolean, courses: Course[]): Draft[] {
  const groupCount = new Map<string, number>();
  for (const c of read) if (c.group) groupCount.set(c.code, (groupCount.get(c.code) ?? 0) + 1);
  return read.map((c) => {
    const existing = findExisting(courses, c.code);
    const hasGroupChoice = (groupCount.get(c.code) ?? 0) > 1;
    return {
      key: uid(),
      selected: highlighted ? c.slots.some((s) => s.highlighted) : !hasGroupChoice,
      code: c.code,
      lecturer: c.lecturer,
      group: c.group,
      existingId: existing?.id,
      slots: c.slots.map((s) => ({ id: uid(), day: s.day, start: s.start, end: s.end, room: s.room || undefined })),
    };
  });
}

export default function ImportRoutine() {
  const navigate = useNavigate();
  const toast = useToast();
  const settings = useSettings();
  const courses = useCourses();
  const [stage, setStage] = useState<Stage>("pick");
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [highlighted, setHighlighted] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [dragging, setDragging] = useState(false);
  const galleryInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const loadFile = useCallback(async (file: File | Blob | null | undefined) => {
    if (!file) return;
    if (file.type && !file.type.startsWith("image/")) {
      setError("That's not an image. Use a photo or screenshot (take a screenshot of PDFs).");
      return;
    }
    setError("");
    try {
      setImage(await prepareImage(file));
    } catch {
      setError("Couldn't open that image. Try a JPG or PNG screenshot.");
    }
  }, []);

  useEffect(() => {
    if (stage !== "pick") return;
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      if (item) loadFile(item.getAsFile());
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [stage, loadFile]);

  const read = async () => {
    if (!image) return;
    setStage("reading");
    setError("");
    setProgress({ label: "Starting…", value: null });
    try {
      const { readRoutine } = await import("~/lib/routine-ocr");
      const result = await readRoutine(image.canvas, setProgress);
      setDrafts(initialDrafts(result.courses, result.highlighted, courses ?? []));
      setNames({});
      setHighlighted(result.highlighted);
      setShowErrors(false);
      setStage("review");
      window.scrollTo({ top: 0 });
    } catch (err) {
      console.error(err);
      const { RoutineReadError } = await import("~/lib/routine-ocr");
      setError(err instanceof RoutineReadError ? err.message : "Something went wrong while reading that picture. Try another screenshot.");
      setStage("pick");
    } finally {
      setProgress(null);
    }
  };

  const cards = useMemo(() => buildCards(drafts), [drafts]);
  const byKey = useMemo(() => new Map(drafts.map((d) => [d.key, d])), [drafts]);

  const update = (key: string, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const pickVariant = (keys: string[], key: string | null) =>
    setDrafts((ds) => ds.map((d) => (keys.includes(d.key) ? { ...d, selected: d.key === key ? !d.selected : false } : d)));

  const selected = drafts.filter((d) => d.selected);
  const selectedSlots = selected.reduce((n, d) => n + d.slots.length, 0);
  const invalidCount = selected.reduce((n, d) => n + d.slots.filter((s) => slotError(s)).length, 0);
  const selectedCards = cards.filter((c) => (c.kind === "single" ? byKey.get(c.key)!.selected : c.keys.some((k) => byKey.get(k)!.selected)));

  // One name per course ID, shared by whichever group of it was picked.
  const namedCodes = useMemo(() => {
    const out = new Map<string, Draft[]>();
    for (const d of drafts) if (d.selected) out.set(d.code, [...(out.get(d.code) ?? []), d]);
    return [...out.entries()];
  }, [drafts]);

  const goToNames = () => {
    if (invalidCount > 0) {
      setShowErrors(true);
      return;
    }
    setNames((prev) => {
      const next = { ...prev };
      for (const [code, ds] of namedCodes) {
        if (next[code] !== undefined) continue;
        const existing = ds[0].existingId != null ? courses?.find((c) => c.id === ds[0].existingId) : undefined;
        next[code] = existing && existing.title !== code ? existing.title : "";
      }
      return next;
    });
    setStage("names");
    window.scrollTo({ top: 0 });
  };

  const save = async () => {
    await importCourses(
      selected.map((d) => ({
        title: names[d.code]?.trim() || d.code.trim(),
        code: d.code.trim(),
        lecturer: d.lecturer.trim(),
        slots: d.slots,
        existingId: d.existingId,
      })),
    );
    toast({
      title: `Imported ${selected.length} course${selected.length === 1 ? "" : "s"}`,
      body: `${selectedSlots} classes a week added to your routine.`,
      tone: "success",
    });
    navigate("/routine");
  };

  const days = orderedWeekdays(settings.weekStart);

  return (
    <>
      <PageHeader
        title={stage === "review" ? "Review classes" : stage === "names" ? "Name your courses" : "Import from photo"}
        subtitle={
          stage === "review"
            ? `Step 1 of 2 · Found ${cards.length} course${cards.length === 1 ? "" : "s"}. Tick the ones you take.`
            : stage === "names"
              ? "Step 2 of 2 · Give each course ID a name you'll recognise."
              : "Read your class routine from a picture"
        }
        leading={
          <button
            className="icon-btn -ml-2"
            aria-label="Back"
            onClick={() => (stage === "names" ? setStage("review") : stage === "review" ? setStage("pick") : navigate("/routine"))}
          >
            <ArrowLeft className="size-5" />
          </button>
        }
      />

      <div className={`flex flex-col gap-4 px-5 ${stage === "review" || stage === "names" ? "pb-24" : ""}`}>
        {(stage === "pick" || stage === "reading") && (
          <>
            <input ref={galleryInput} type="file" accept="image/*" className="hidden" onChange={(e) => loadFile(e.target.files?.[0])} />
            <input
              ref={cameraInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => loadFile(e.target.files?.[0])}
            />

            {image ? (
              <section className="card overflow-hidden">
                <img src={image.previewUrl} alt="Your routine" className="max-h-[50dvh] w-full bg-zinc-100 object-contain dark:bg-zinc-800" />
                {stage === "reading" && progress ? (
                  <div className="p-4">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                      <span className="size-4 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600 dark:border-indigo-900 dark:border-t-indigo-400" />
                      {progress.label}
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className={`h-full rounded-full bg-indigo-600 transition-[width] duration-300 ${progress.value === null ? "w-1/3 animate-pulse" : ""}`}
                        style={progress.value === null ? undefined : { width: `${Math.max(4, progress.value * 100)}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2 p-3">
                    <button className="btn-secondary flex-1" onClick={() => galleryInput.current?.click()}>
                      <RotateCcw className="size-4" /> Change
                    </button>
                    <button className="btn-primary flex-[2]" onClick={read}>
                      <ScanText className="size-4" /> Read routine
                    </button>
                  </div>
                )}
              </section>
            ) : (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  loadFile(e.dataTransfer.files?.[0]);
                }}
                className={`flex flex-col items-center rounded-3xl border-2 border-dashed px-6 py-10 text-center transition ${
                  dragging ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10" : "border-zinc-300 dark:border-zinc-700"
                }`}
              >
                <div className="mb-3 rounded-2xl bg-indigo-50 p-3 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
                  <ImagePlus className="size-6" />
                </div>
                <p className="font-semibold">Add a picture of your routine</p>
                <p className="mt-1 max-w-xs text-sm text-zinc-500">A screenshot works best. You can also drop or paste an image here.</p>
                <div className="mt-5 grid w-full max-w-xs grid-cols-2 gap-2">
                  <button className="btn-secondary" onClick={() => cameraInput.current?.click()}>
                    <Camera className="size-4" /> Camera
                  </button>
                  <button className="btn-primary" onClick={() => galleryInput.current?.click()}>
                    <ImagePlus className="size-4" /> Choose
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                {error}
              </div>
            )}

            <ul className="space-y-1.5 px-1 text-xs text-zinc-500">
              <li>• Works with routines drawn as a table with visible lines: days down the side and time slots across the top, or the other way round.</li>
              <li>• Use a straight, sharp screenshot cropped to the routine. Got a PDF? Screenshot the page.</li>
              <li>• Highlighted your own classes? They'll be picked for you.</li>
              <li>• Only the routine table is read. Next you'll pick your group for each course, fix anything misread, then name each course ID.</li>
            </ul>
            <p className="flex items-start gap-2 px-1 text-xs text-zinc-500">
              <ShieldCheck className="size-4 shrink-0 text-emerald-500" />
              Read entirely on your device. The picture never leaves it. The first time, the text recognizer (about 7 MB) downloads
              once, and after that it works offline.
            </p>
          </>
        )}

        {stage === "review" && (
          <>
            {highlighted && (
              <section className="flex items-start gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                <Highlighter className="mt-0.5 size-4 shrink-0" />
                <p>
                  Picked the classes you highlighted. Check the ticks below and change anything that's off.
                </p>
              </section>
            )}

            <div className="flex items-center justify-between px-1">
              <span className="text-sm text-zinc-500">
                {selectedCards.length} of {cards.length} selected
              </span>
              {selectedCards.length > 0 && (
                <button
                  className="text-sm font-semibold text-indigo-600 dark:text-indigo-400"
                  onClick={() => setDrafts((ds) => ds.map((d) => ({ ...d, selected: false })))}
                >
                  Clear all
                </button>
              )}
            </div>

            {image && (
              <details className="card overflow-hidden">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Compare with the picture</summary>
                <img src={image.previewUrl} alt="Your routine" className="w-full" />
              </details>
            )}

            <ul className="flex flex-col gap-3">
              {cards.map((card) => {
                const variants = card.kind === "single" ? [byKey.get(card.key)!] : card.keys.map((k) => byKey.get(k)!);
                const active = variants.find((v) => v.selected);
                const first = variants[0];
                const shown = active ?? first;
                const isOn = !!active;
                const toggle = () => {
                  if (card.kind === "single") update(card.key, { selected: !first.selected });
                  else if (active) pickVariant(card.keys, active.key);
                  else pickVariant(card.keys, first.key);
                };
                const setCode = (code: string) =>
                  setDrafts((ds) => ds.map((d) => (variants.some((v) => v.key === d.key) ? { ...d, code } : d)));

                return (
                  <li key={card.kind === "single" ? card.key : card.code} className={`card p-4 transition ${isOn ? "" : "opacity-60"}`}>
                    <div className="flex items-start gap-3">
                      <button
                        role="checkbox"
                        aria-checked={isOn}
                        aria-label={`Include ${shown.code}`}
                        onClick={toggle}
                        className={`mt-1.5 flex size-6 shrink-0 items-center justify-center rounded-lg border-2 transition ${
                          isOn ? "border-indigo-600 bg-indigo-600 text-white" : "border-zinc-300 dark:border-zinc-600"
                        }`}
                      >
                        {isOn && <Check className="size-4" strokeWidth={3} />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <input
                          aria-label="Course ID"
                          className="w-full rounded-lg bg-transparent px-1 py-1 font-semibold outline-none focus:bg-zinc-50 dark:focus:bg-zinc-800"
                          value={shown.code}
                          onChange={(e) => setCode(e.target.value)}
                        />
                        <div className="flex flex-wrap items-center gap-1.5 px-1 text-xs text-zinc-500">
                          {shown.lecturer && <span>{shown.lecturer}</span>}
                          {card.kind === "single" && shown.group && (
                            <span className="rounded-md bg-indigo-100 px-1.5 py-0.5 font-bold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                              {shown.group}
                            </span>
                          )}
                          {shown.existingId != null && (
                            <span className="rounded-md bg-amber-100 px-1.5 py-0.5 font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                              Updates existing course
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {card.kind === "groups" && (
                      <div className="mt-3 pl-9">
                        <p className="mb-1.5 text-xs font-medium text-zinc-500">{active ? "Your group" : "Which group are you in?"}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {variants.map((v) => (
                            <button
                              key={v.key}
                              aria-pressed={v.selected}
                              onClick={() => pickVariant(card.keys, v.key)}
                              className={`rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold transition ${
                                v.selected
                                  ? "bg-indigo-600 text-white"
                                  : "bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                              }`}
                            >
                              {v.group}
                              <span className={`block text-[10px] font-normal ${v.selected ? "text-indigo-100" : "text-zinc-500"}`}>
                                {slotSummary(v.slots)}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {active && (
                      <SlotEditor
                        draft={active}
                        days={days}
                        showErrors={showErrors}
                        onChange={(slots) => update(active.key, { slots })}
                      />
                    )}

                    {!active && card.kind === "single" && first.slots.length > 0 && (
                      <p className="mt-1 pl-10 text-xs text-zinc-500">{slotSummary(first.slots)}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {stage === "names" && (
          <>
            <p className="px-1 text-sm text-zinc-500">
              The routine only shows course IDs. Type the full name for each, or leave it blank to use the ID as the name.
            </p>
            <ul className="flex flex-col gap-3">
              {namedCodes.map(([code, ds]) => {
                const details = [
                  ds.map((d) => d.lecturer).find(Boolean),
                  ds.map((d) => d.group).filter(Boolean).join(", "),
                  `${ds.reduce((n, d) => n + d.slots.length, 0)} class${ds.reduce((n, d) => n + d.slots.length, 0) === 1 ? "" : "es"}/week`,
                ].filter(Boolean);
                return (
                  <li key={code} className="card p-4">
                    <label className="block">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <span className="font-semibold">{code}</span>
                        <span className="text-xs text-zinc-500">{details.join(" · ")}</span>
                      </span>
                      <input
                        className="input mt-2"
                        placeholder="Full course name"
                        aria-label={`Name for ${code}`}
                        value={names[code] ?? ""}
                        onChange={(e) => setNames((n) => ({ ...n, [code]: e.target.value }))}
                        enterKeyHint="next"
                        autoCapitalize="words"
                      />
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {stage === "review" && (
        <div className="fixed inset-x-0 bottom-[calc(4.6rem+env(safe-area-inset-bottom))] z-20 mx-auto max-w-md px-5">
          {showErrors && invalidCount > 0 && (
            <p className="mb-2 rounded-xl bg-rose-600 px-3 py-2 text-center text-xs font-medium text-white shadow-lg">
              Fix {invalidCount} highlighted time{invalidCount === 1 ? "" : "s"} or remove them.
            </p>
          )}
          <button className="btn-primary w-full py-3 shadow-lg" disabled={selected.length === 0} onClick={goToNames}>
            Next: name {namedCodes.length} course{namedCodes.length === 1 ? "" : "s"}
            <ArrowRight className="size-4" />
          </button>
        </div>
      )}

      {stage === "names" && (
        <div className="fixed inset-x-0 bottom-[calc(4.6rem+env(safe-area-inset-bottom))] z-20 mx-auto max-w-md px-5">
          <button className="btn-primary w-full py-3 shadow-lg" onClick={save}>
            <Check className="size-4" />
            Add {namedCodes.length} course{namedCodes.length === 1 ? "" : "s"} · {selectedSlots} class{selectedSlots === 1 ? "" : "es"}/week
          </button>
        </div>
      )}
    </>
  );
}

function SlotEditor({
  draft,
  days,
  showErrors,
  onChange,
}: {
  draft: Draft;
  days: Weekday[];
  showErrors: boolean;
  onChange: (slots: Slot[]) => void;
}) {
  const patch = (id: string, p: Partial<Slot>) => onChange(draft.slots.map((s) => (s.id === id ? { ...s, ...p } : s)));
  return (
    <div className="mt-3 flex flex-col gap-2 pl-9">
      {draft.slots.map((s) => {
        const err = showErrors ? slotError(s) : null;
        return (
          <div key={s.id}>
            <div className={`flex items-center gap-1.5 rounded-xl ${err ? "ring-2 ring-rose-500" : ""}`}>
              <select
                aria-label="Day"
                className="input w-auto px-2 py-1.5"
                value={s.day}
                onChange={(e) => patch(s.id, { day: Number(e.target.value) as Weekday })}
              >
                {days.map((day) => (
                  <option key={day} value={day}>
                    {DAY_SHORT[day]}
                  </option>
                ))}
              </select>
              <input
                type="time"
                aria-label="Start time"
                className="input min-w-0 px-2 py-1.5"
                value={s.start}
                onChange={(e) => patch(s.id, { start: e.target.value })}
              />
              <input
                type="time"
                aria-label="End time"
                className="input min-w-0 px-2 py-1.5"
                value={s.end}
                onChange={(e) => patch(s.id, { end: e.target.value })}
              />
              <button
                className="icon-btn shrink-0 hover:text-rose-600"
                aria-label="Remove class time"
                onClick={() => onChange(draft.slots.filter((x) => x.id !== s.id))}
              >
                <X className="size-4" />
              </button>
            </div>
            {err && <p className="mt-1 text-xs text-rose-500">{err}</p>}
            {!err && s.room && <p className="mt-0.5 pl-1 text-[11px] text-zinc-500">Room {s.room}</p>}
          </div>
        );
      })}
      <button
        className="self-start text-xs font-semibold text-indigo-600 dark:text-indigo-400"
        onClick={() => {
          const last = draft.slots.at(-1);
          onChange([...draft.slots, { id: uid(), day: last?.day ?? days[0], start: last?.start ?? "09:00", end: last?.end ?? "10:30" }]);
        }}
      >
        <Plus className="mr-0.5 inline size-3.5" />
        Add time
      </button>
    </div>
  );
}
