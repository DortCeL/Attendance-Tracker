import type { Weekday } from "~/lib/types";
import type { SimCourse } from "./simulator";

const MON: Weekday = 1;
const TUE: Weekday = 2;
const WED: Weekday = 3;

/** The highlighted classes from public/routine.jpg (Year 4, Semester 2, Section B). 15 classes a week. */
export const SAMPLE_ROUTINE: SimCourse[] = [
  {
    code: "CSE 4203",
    title: "Computer Graphics",
    lecturer: "RZC",
    slots: [
      { day: MON, start: "09:40", end: "10:30", room: "7A06" },
      { day: WED, start: "08:50", end: "09:40", room: "7A06" },
      { day: WED, start: "09:40", end: "10:30", room: "7A06" },
    ],
  },
  {
    code: "CSE 4204",
    title: "Computer Graphics Lab",
    lecturer: "Era, RZC",
    slots: [{ day: TUE, start: "08:00", end: "10:30", room: "7B06" }],
  },
  {
    code: "CSE 4227",
    title: "Digital Image Processing",
    lecturer: "Dr. Kalpoma",
    slots: [
      { day: MON, start: "10:30", end: "11:20", room: "7A06" },
      { day: TUE, start: "10:30", end: "11:20", room: "7A06" },
      { day: WED, start: "10:30", end: "11:20", room: "7A06" },
    ],
  },
  {
    code: "CSE 4228",
    title: "Digital Image Processing Lab",
    lecturer: "Joy, Muthaki",
    slots: [{ day: TUE, start: "08:00", end: "10:30", room: "7B03" }],
  },
  {
    code: "CSE 4263",
    title: "Internet of Things",
    lecturer: "Ahmed",
    slots: [
      { day: MON, start: "11:20", end: "12:10", room: "7C06" },
      { day: MON, start: "15:30", end: "16:20", room: "7A04" },
      { day: TUE, start: "14:40", end: "15:30", room: "7C06" },
    ],
  },
  {
    code: "CSE 4264",
    title: "Internet of Things Lab",
    lecturer: "Ahmed",
    slots: [{ day: MON, start: "13:00", end: "15:30", room: "7B05" }],
  },
  {
    code: "CSE 4267",
    title: "Cloud Computing",
    lecturer: "TFQ",
    slots: [
      { day: TUE, start: "11:20", end: "12:10", room: "7C07" },
      { day: TUE, start: "12:10", end: "13:00", room: "7C07" },
      { day: WED, start: "08:00", end: "08:50", room: "7A05" },
    ],
  },
];

/** A Sunday. 14 weeks later is Sat 2026-10-10. */
export const TERM_START = "2026-07-05";
export const WEEKS = 14;

/** CSE 4204 and CSE 4228 (B1/B2) share Tuesday 08:00 — they run on alternate weeks. */
export function alternatingLabCancelled(code: string, week: number): boolean {
  return (code === "CSE 4204" && week % 2 === 0) || (code === "CSE 4228" && week % 2 === 1);
}

export function pick(codes: string[]): SimCourse[] {
  return SAMPLE_ROUTINE.filter((c) => codes.includes(c.code));
}
