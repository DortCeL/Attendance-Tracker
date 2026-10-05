import type { Weekday } from "../types";

const DAY_NAMES: [string, Weekday][] = [
  ["SUN", 0], ["SUNDAY", 0],
  ["MON", 1], ["MONDAY", 1],
  ["TUE", 2], ["TUES", 2], ["TUESDAY", 2],
  ["WED", 3], ["WEDNESDAY", 3],
  ["THU", 4], ["THUR", 4], ["THURS", 4], ["THURSDAY", 4],
  ["FRI", 5], ["FRIDAY", 5],
  ["SAT", 6], ["SATURDAY", 6],
];

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

const LOOKALIKES = new Set(["S5", "O0", "I1", "l1", "Il", "B8", "Z2", "G6"].flatMap((p) => [p, p[1] + p[0]]));

/** One stray inserted/dropped character, or a single look-alike swap such as S↔5 or O↔0. */
function isOcrVariant(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) === 1) return editDistance(a, b) === 1;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (!LOOKALIKES.has(a[i] + b[i]) || ++diff > 1) return false;
  }
  return diff === 1;
}

const TOKEN_RE = /[A-Za-z0-9]{3,}/g;

/**
 * The same labels repeat across a routine (and its course list), and OCR rarely misreads every
 * copy the same way, so the most common spelling of near-identical tokens wins.
 */
export function buildCorrector(texts: string[]): (s: string) => string {
  const counts = new Map<string, number>();
  for (const t of texts) for (const [tok] of t.matchAll(TOKEN_RE)) counts.set(tok, (counts.get(tok) ?? 0) + 1);
  const fixToken = (tok: string) => {
    let best = tok;
    let bestCount = counts.get(tok) ?? 0;
    for (const [candidate, n] of counts) {
      if (!isOcrVariant(tok, candidate)) continue;
      if (n > bestCount || (n === bestCount && candidate.length < best.length)) {
        best = candidate;
        bestCount = n;
      }
    }
    return best;
  };
  return (s) => s.replace(TOKEN_RE, fixToken);
}

/** Reads a day label, tolerating one or two OCR mistakes ("TUF", "WEDNESDAV"). */
export function parseDay(text: string): Weekday | null {
  const s = text.toUpperCase().replace(/[^A-Z]/g, "");
  if (s.length < 2 || s.length > 10) return null;
  let best: { day: Weekday; dist: number } | null = null;
  for (const [name, day] of DAY_NAMES) {
    const dist = editDistance(s, name);
    const allowed = name.length <= 4 ? 1 : 2;
    if (dist <= allowed && (!best || dist < best.dist)) best = { day, dist };
  }
  return best?.day ?? null;
}

function to24(h: number, m: number, suffix: "a" | "p" | null): number {
  if (suffix === "p" && h < 12) h += 12;
  else if (suffix === "a" && h === 12) h = 0;
  // Classes don't run between 1 and 6 AM, so an unlabeled "1:30" means the afternoon.
  else if (!suffix && h >= 1 && h <= 6) h += 12;
  return h * 60 + m;
}

export const minutesToHHMM = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;

/** Finds a "08:00 AM - 08:50 AM" style range. Returns minutes since midnight. */
export function parseTimeRange(text: string): [number, number] | null {
  const s = text.replace(/(?<=\d)[Oo]|[Oo](?=\d)/g, "0").replace(/(?<=\d)[lI|]|[lI|](?=\d)/g, "1");
  const re = /(\d{1,2})\s*[:.;,]\s*(\d{2})\s*(?:([AaPp])\.?\s*[Mm]\.?)?/g;
  const found: { h: number; m: number; suffix: "a" | "p" | null }[] = [];
  for (const m of s.matchAll(re)) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) continue;
    found.push({ h, m: min, suffix: m[3] ? (m[3].toLowerCase() as "a" | "p") : null });
    if (found.length === 2) break;
  }
  if (found.length < 2) return null;
  const [a, b] = found;
  const end = to24(b.h, b.m, b.suffix);
  let start = to24(a.h, a.m, a.suffix ?? b.suffix);
  if (!a.suffix && start >= end) start = to24(a.h, a.m, null);
  if (end <= start || end - start > 6 * 60) return null;
  return [start, end];
}

export interface ClassEntry {
  code: string;
  group: string;
  room: string;
  lecturer: string;
}

const NOT_A_COURSE = new Set(["AM", "PM", "ROOM", "RM", "LAB", "SEC", "GR", "GROUP", "TIME", "DAY", "YEAR", "TERM", "LEVEL", "BLDG", "NO"]);
const CODE_RE = /\b([A-Z]{2,5})\s*[-–]?\s*([0-9OIlSZ|]{3,4})(?![0-9A-Za-z])/g;
const DIGIT_FIX: Record<string, string> = { O: "0", I: "1", l: "1", "|": "1", S: "5", Z: "2" };

export const cleanText = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * OCR often reads "IOT" as "10T". Inside a label, 0/1 that come before a letter are almost
 * always O/I, while trailing digits ("B1", "Gr-2") are real.
 */
export function fixGroupOcr(group: string): string {
  return group.replace(/[A-Za-z0-9]{3,}/g, (run) => {
    if (!/[A-Za-z]/.test(run)) return run;
    const suffix = run.match(/\d*$/)![0];
    const head = run.slice(0, run.length - suffix.length).replace(/0/g, "O").replace(/1/g, "I");
    return head + suffix;
  });
}

interface CodeMatch {
  code: string;
  digits: string;
  index: number;
  end: number;
}

export function findCodes(text: string): CodeMatch[] {
  const out: CodeMatch[] = [];
  for (const m of text.matchAll(CODE_RE)) {
    const [, prefix, rawNum] = m;
    if (NOT_A_COURSE.has(prefix)) continue;
    if ((rawNum.match(/\d/g)?.length ?? 0) < 2) continue;
    const digits = rawNum.replace(/[OIlSZ|]/g, (c) => DIGIT_FIX[c]);
    out.push({ code: `${prefix} ${digits}`, digits, index: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

const OPEN = "[\\(\\[\\{]";
const CLOSE = "[\\)\\]\\}]";
const GROUP_RE = new RegExp(`^\\s*${OPEN}\\s*([^\\)\\]\\}]{1,20}?)\\s*${CLOSE}`);
const PAREN_RE = new RegExp(`${OPEN}\\s*([^\\)\\]\\}]{2,40}?)\\s*(?:${CLOSE}|$)`, "g");
const ROOM_RE = /^(?=.*\d)[A-Z0-9][A-Z0-9\-/]{1,7}$/i;

/** Group in brackets right after the course ID, then room and teacher from whatever follows. */
function parseDetails(after: string): Omit<ClassEntry, "code"> {
  let rest = after;
  let group = "";
  const g = rest.match(GROUP_RE);
  if (g) {
    group = fixGroupOcr(cleanText(g[1]));
    rest = rest.slice(g[0].length);
  }

  let lecturer = "";
  const parens = [...rest.matchAll(PAREN_RE)];
  if (parens.length) {
    const last = parens[parens.length - 1];
    lecturer = cleanText(last[1]).replace(/[^A-Za-z.,\s]/g, "").trim();
    rest = rest.slice(0, last.index) + rest.slice(last.index! + last[0].length);
  }

  let room = "";
  const leftover: string[] = [];
  for (const token of rest.split(/\s+/).filter(Boolean)) {
    const tok = token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    if (!tok) continue;
    if (!room && ROOM_RE.test(tok) && tok.length >= 3) room = tok.toUpperCase();
    else if (/^[A-Za-z][A-Za-z.]{1,}$/.test(tok)) leftover.push(tok);
  }
  if (!lecturer && leftover.length && leftover.length <= 3) lecturer = leftover.join(" ");

  return { group, room, lecturer };
}

const NOT_A_CLASS = /^(break|lunch|prayer|recess|tiffin|free|off|holiday|no class|closed)\b/i;

/**
 * Splits a cell like "CSE 4263(IOT) 7C06 (Ahmed)" into its parts. A cell can hold several
 * classes. Cells without a course code use their first line as the course ID ("Physics (A)").
 */
export function parseClassCell(text: string): ClassEntry[] {
  const t = cleanText(text);
  const codes = findCodes(t);
  if (codes.length > 0) {
    return codes.map((c, i) => ({ code: c.code, ...parseDetails(t.slice(c.end, codes[i + 1]?.index ?? t.length)) }));
  }

  const lines = text.split(/\r?\n/).map(cleanText).filter(Boolean);
  if (lines.length === 0) return [];
  const [first, ...more] = lines;
  const bracket = first.search(new RegExp(OPEN));
  const label = (bracket > 0 ? first.slice(0, bracket) : first).replace(/[^A-Za-z0-9&/.\- ]/g, "").trim().slice(0, 40);
  if ((label.match(/[A-Za-z]/g)?.length ?? 0) < 3 || NOT_A_CLASS.test(label)) return [];
  const details = parseDetails(`${bracket > 0 ? first.slice(bracket) : ""} ${more.join(" ")}`);
  return [{ code: label, ...details }];
}
