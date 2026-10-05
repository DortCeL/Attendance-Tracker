# Attendance Tracker

An installable, offline-first PWA for tracking class attendance. Set up your weekly routine once; every day the app lists your classes so you can mark each one **attended**, **missed** or **cancelled**. It keeps a running percentage per course and warns you as you approach your minimum (e.g. 60%).

All data stays on your device (IndexedDB). There is no server or account.

## Features

- **Weekly routine**: courses with any number of weekly time slots (day, start/end, room), color, lecturer, code.
- **Import routine from a picture**: read a screenshot or photo of a table-style class routine entirely on the device, with no AI service, account or API key. The table's lines are detected with plain canvas pixel analysis, so merged cells (labs spanning several periods) and stacked group rows keep their correct times. Each cell is then read with [Tesseract.js](https://github.com/naptha/tesseract.js) OCR. Only the routine table is read (the one with a time-slot header and day labels); course lists or notes elsewhere in the picture are ignored. Days and time slots come from the row and column headers, and each class keeps exactly the course ID written in its cell. Labels that repeat across the routine are used to correct OCR slips. Classes you highlighted are preselected, and courses split into groups get a per-course group picker. In a final step you type a name for each course ID, or leave it blank to use the ID. Courses that already exist are updated instead of duplicated. The OCR engine (~7 MB, self-hosted from `public/ocr/`, copied there by `scripts/copy-ocr-assets.mjs`) downloads the first time it's used and then works offline.
- **Daily tracking**: today's classes with one-tap Attended / Missed / Cancelled. Browse any date with the week strip or date picker. Tap a selected status again to un-mark it.
- **Bulk actions**: "All attended" for the day, "Holiday" to cancel every class that day.
- **Unmarked backlog**: past classes you forgot to mark (since the term start date) are collected into a review list.
- **Extra classes**: add one-off / makeup classes on any date; they count toward that course.
- **Stats**: per-course percentage with a threshold marker, attended / missed / cancelled counts and an overall summary.
  - *"You can miss N more classes"* while you're safe
  - *"Missing the next class drops you to X%"* when you're on the edge
  - *"Attend the next N classes to recover"* when you're below
- **Warnings**: a course turns amber when it's within the *warning zone* (default 5 points) above its threshold, or when one more miss would put it under; red when below. Marking a miss that causes this shows a toast and, if enabled, a system notification.
- **Per-course threshold** overrides the global one.
- **What-if planner** on each course page.
- **Editable history** per course.
- **Backup**: export / import JSON, clear marks, reset everything.
- Light / dark / system theme, week start (Sat / Sun / Mon).

Cancelled classes never affect the percentage: `attended / (attended + missed)`.

## Development

```bash
bun install
bun run dev        # http://localhost:5173
bun run typecheck
```

## Testing

```bash
bun run test            # everything (unit tests + semester simulations)
bun run test:semester   # just the 14-week simulations, with printed reports
```

The tests run the real storage, schedule and stats code against an in-memory IndexedDB (`fake-indexeddb`). `tests/semester.test.ts` plays out whole 14-week terms on the sample routine (holidays, midterms, sick weeks, alternating labs, makeup classes, forgotten marks, routine changes...) and prints a per-course report with a week-by-week percentage chart and every warning the app would have shown. The app's numbers are cross-checked against an independent tally.

## Preview build

The service worker is only registered in production builds, so use the preview server to test offline/install behaviour:

```bash
bun run build
bun run start      # http://localhost:4173 (also exposed on your LAN)
```

> Installing as a PWA and notifications require a secure context: `localhost` or HTTPS. To try it on your phone, deploy it (see below) or tunnel the preview server over HTTPS.

## Deployment

`bun run build` outputs a static site in `build/client/`. Host it anywhere static (Netlify, Vercel, Cloudflare Pages, GitHub Pages, nginx). Make sure unknown paths fall back to `index.html` and that `sw.js` / `index.html` aren't cached long-term.

Docker (nginx):

```bash
docker build -t attendance-tracker .
docker run -p 8080:80 attendance-tracker
```

## Project structure

```
app/
  root.tsx              layout, theme, service worker registration, bottom nav
  routes/
    home.tsx            Today: daily classes, week strip, alerts, backlog
    stats.tsx           overall + per-course stats
    course.tsx          course detail, what-if planner, history
    routine.tsx         weekly routine & course list
    settings.tsx        threshold, warning zone, term start, theme, backup
  components/           ClassCard, CourseForm, Sheet, Toast, Progress, ...
  database/db.ts        Dexie schema (with migration from v1) and data API
  lib/
    stats.ts            percentage / can-skip / need-to-attend / risk logic
    schedule.ts         builds a day's class list and the unmarked backlog
public/
  sw.js                 service worker (asset list stamped in at build time)
  manifest.webmanifest
scripts/
  generate-icons.mjs    renders the PNG/ICO icons (bun run icons)
  postbuild.mjs         stamps sw.js with the build's asset list + version
tests/
  unit/                 dates, stats, alerts, schedule, storage
  semester.test.ts      14-week semester simulations
  helpers/              simulator, report printer, shared invariants
```
