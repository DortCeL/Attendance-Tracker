import { createScheduler, createWorker, OEM, PSM } from "tesseract.js";
import type { Weekday } from "../types";
import { analyzeGrid, renderForOcr, type Cell, type Grid } from "./grid";
import { buildCorrector, minutesToHHMM, parseClassCell, parseDay, parseTimeRange, type ClassEntry } from "./parse";

export interface ReadSlot {
  day: Weekday;
  start: string;
  end: string;
  room: string;
  highlighted: boolean;
}

export interface ReadCourse {
  /** Exactly what identifies the class in the routine cell: usually a course code like "CSE 4203". */
  code: string;
  lecturer: string;
  group: string;
  slots: ReadSlot[];
}

export interface RoutineResult {
  courses: ReadCourse[];
  /** The user marked their own classes with a highlighter; only those are preselected. */
  highlighted: boolean;
}

export interface Progress {
  label: string;
  /** 0–1, or null when indeterminate. */
  value: number | null;
}

export class RoutineReadError extends Error {}

const MAX_SIDE = 2200;

const ocrBase = () => new URL("/ocr/", window.location.origin).href;

async function createOcr(onLoad: (p: number) => void) {
  const count = (navigator.hardwareConcurrency ?? 2) >= 4 ? 2 : 1;
  const loaded = new Array(count).fill(0);
  const scheduler = createScheduler();
  const workers = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      createWorker("eng", OEM.LSTM_ONLY, {
        workerPath: `${ocrBase()}worker.min.js`,
        corePath: `${ocrBase()}core`,
        langPath: `${ocrBase()}lang`,
        workerBlobURL: false,
        logger: (m) => {
          if (m.status.startsWith("loading")) {
            loaded[i] = m.status.includes("traineddata") ? 0.5 + m.progress / 2 : m.progress / 2;
            onLoad(loaded.reduce((a, b) => a + b, 0) / count);
          }
        },
      }),
    ),
  );
  for (const w of workers) {
    await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: "1" });
    scheduler.addWorker(w);
  }
  return {
    read: async (canvas: HTMLCanvasElement) => (await scheduler.addJob("recognize", canvas)).data.text ?? "",
    terminate: () => scheduler.terminate(),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function toImageData(source: HTMLCanvasElement | ImageBitmap): ImageData {
  const scale = Math.min(1, MAX_SIDE / Math.max(source.width, source.height));
  const w = Math.round(source.width * scale);
  const h = Math.round(source.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

export async function readRoutine(
  source: HTMLCanvasElement | ImageBitmap,
  onProgress: (p: Progress) => void = () => {},
): Promise<RoutineResult> {
  onProgress({ label: "Finding the timetable…", value: null });
  await tick();
  const grid = analyzeGrid(toImageData(source));
  if (grid.cells.length < 4) {
    throw new RoutineReadError(
      "Couldn't find a timetable grid. This works with routines that have visible table lines. Try a sharp, straight screenshot cropped to the table.",
    );
  }

  const minInk = grid.charH * grid.charH * 0.25;
  const textCells = grid.cells.filter((c) => c.ink >= minInk);

  onProgress({ label: "Loading text recognizer…", value: 0 });
  let ocr: Awaited<ReturnType<typeof createOcr>>;
  try {
    ocr = await createOcr((p) => onProgress({ label: "Loading text recognizer…", value: p }));
  } catch (err) {
    console.error(err);
    throw new RoutineReadError(
      navigator.onLine
        ? "Couldn't start the text recognizer. Reload the app and try again."
        : "The text recognizer hasn't been downloaded yet. Connect to the internet once, then try again (after that it works offline).",
    );
  }

  const texts = new Map<number, string>();
  try {
    // Read each table's header row and first column first, then the body of routine tables
    // only, so course lists and legends below the routine aren't read at all.
    const origin = new Map<number, { x: number; y: number }>();
    for (const c of grid.cells) {
      const o = origin.get(c.table) ?? { x: Infinity, y: Infinity };
      origin.set(c.table, { x: Math.min(o.x, c.x0), y: Math.min(o.y, c.y0) });
    }
    const isEdge = (c: Cell) => c.y0 - origin.get(c.table)!.y < grid.charH || c.x0 - origin.get(c.table)!.x < grid.charH;
    const edgeCells = textCells.filter(isEdge);

    let done = 0;
    let total = textCells.length;
    const step = () => onProgress({ label: "Reading the routine…", value: done / total });
    const readAll = (cells: Cell[]) =>
      Promise.all(
        cells.map(async (c) => {
          texts.set(c.id, await ocr.read(renderForOcr(grid, c)));
          done++;
          step();
        }),
      );

    step();
    await readAll(edgeCells);
    const routineTables = new Set(
      grid.tables
        .filter((t) => {
          const header = edgeCells.filter((c) => c.table === t.id).map((c) => texts.get(c.id) ?? "");
          return header.filter((s) => parseTimeRange(s)).length >= 2 && header.some((s) => parseDay(s) !== null);
        })
        .map((t) => t.id),
    );
    // No recognizable header in the first row/column (e.g. a title row on top): read everything.
    const body = textCells.filter((c) => !texts.has(c.id) && (routineTables.size === 0 || routineTables.has(c.table)));
    total = done + body.length;
    await readAll(body);
  } finally {
    ocr.terminate();
  }

  onProgress({ label: "Putting it together…", value: 1 });
  await tick();
  return buildRoutine(grid, texts);
}

interface Axis {
  lo: number;
  hi: number;
}

interface TimeCol extends Axis {
  start: number;
  end: number;
}

const overlap = (a: Axis, b: Axis) => Math.max(0, Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo));

/** Only tables with a time-slot header and day labels count as a routine; anything else (course lists, legends) is ignored. */
function buildRoutine(grid: Grid, texts: Map<number, string>): RoutineResult {
  const found: { entry: ClassEntry; day: Weekday; start: string; end: string; highlighted: boolean }[] = [];
  const routineTexts: string[] = [];
  let classCells = 0;
  let highlightedCells = 0;

  for (const table of grid.tables) {
    const cells = grid.cells.filter((c) => c.table === table.id && texts.has(c.id));
    const text = (c: Cell) => texts.get(c.id) ?? "";

    const times = new Map<number, [number, number]>();
    const days = new Map<number, Weekday>();
    for (const c of cells) {
      const range = parseTimeRange(text(c));
      if (range) times.set(c.id, range);
      else {
        const day = parseDay(text(c));
        if (day !== null) days.set(c.id, day);
      }
    }
    if (times.size < 2 || days.size < 1) continue;
    routineTexts.push(...cells.map(text));

    const timeCells = cells.filter((c) => times.has(c.id));
    const xs = timeCells.map((c) => (c.x0 + c.x1) / 2);
    const ys = timeCells.map((c) => (c.y0 + c.y1) / 2);
    const timesAcross = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
    const timeAxis = (b: Cell): Axis => (timesAcross ? { lo: b.x0, hi: b.x1 } : { lo: b.y0, hi: b.y1 });
    const dayAxis = (b: Cell): Axis => (timesAcross ? { lo: b.y0, hi: b.y1 } : { lo: b.x0, hi: b.x1 });

    const cols: TimeCol[] = timeCells
      .map((c) => ({ ...timeAxis(c), start: times.get(c.id)![0], end: times.get(c.id)![1] }))
      .sort((a, b) => a.lo - b.lo);
    const rows = cells.filter((c) => days.has(c.id)).map((c) => ({ ...dayAxis(c), day: days.get(c.id)! }));
    const headerEdge = timesAcross ? Math.max(...timeCells.map((c) => c.y1)) : Math.max(...timeCells.map((c) => c.x1));

    for (const c of cells) {
      if (times.has(c.id) || days.has(c.id)) continue;
      const entries = parseClassCell(text(c));
      if (entries.length === 0) continue;

      const along = timeAxis(c);
      const across = dayAxis(c);
      if (across.hi <= headerEdge) continue;
      const spanned = cols.filter((col) => overlap(col, along) >= 0.5 * (col.hi - col.lo));
      if (spanned.length === 0) continue;
      const mid = (across.lo + across.hi) / 2;
      const row =
        rows.find((r) => mid >= r.lo && mid <= r.hi) ??
        rows.reduce((best, r) => (Math.abs((r.lo + r.hi) / 2 - mid) < Math.abs((best.lo + best.hi) / 2 - mid) ? r : best));

      const highlighted = c.colored / c.pixels >= 0.06;
      classCells++;
      if (highlighted) highlightedCells++;

      const start = minutesToHHMM(spanned[0].start);
      const end = minutesToHHMM(Math.max(...spanned.map((s) => s.end)));
      for (const entry of entries) found.push({ entry, day: row.day, start, end, highlighted });
    }
  }

  const fix = buildCorrector([...routineTexts, ...found.map((f) => f.entry.group)]);
  const courses = new Map<string, ReadCourse>();
  for (const { entry, day, start, end, highlighted } of found) {
    const group = fix(entry.group);
    const lecturer = fix(entry.lecturer);
    const key = `${entry.code}|${group.toUpperCase().replace(/\s+/g, "")}`;
    let course = courses.get(key);
    if (!course) {
      course = { code: entry.code, lecturer, group, slots: [] };
      courses.set(key, course);
    }
    if (!course.lecturer) course.lecturer = lecturer;
    const existing = course.slots.find((s) => s.day === day && s.start === start);
    if (existing) existing.highlighted ||= highlighted;
    else course.slots.push({ day, start, end, room: fix(entry.room), highlighted });
  }

  if (courses.size === 0) {
    throw new RoutineReadError(
      grid.tables.length
        ? "Found a table but couldn't match classes to days and times. Make sure the day names and the time-slot header are in the picture."
        : "Couldn't find a timetable grid. Try a sharp, straight screenshot cropped to the table.",
    );
  }

  const list = [...courses.values()]
    .map((c) => ({ ...c, slots: c.slots.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start)) }))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }) || a.group.localeCompare(b.group, undefined, { numeric: true }));

  // A few marked cells mean "these are mine"; colour on nearly every cell is just styling.
  const highlighted = highlightedCells > 0 && highlightedCells < classCells * 0.85;
  return { courses: list, highlighted };
}
