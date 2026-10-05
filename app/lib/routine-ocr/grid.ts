/**
 * Finds tables and their cells in a routine image using only pixel analysis: ruling lines are
 * long connected strokes of dark pixels, and every enclosed region between them is a cell.
 * Merged cells (a lab spanning three periods) naturally come out as one wide region.
 */

export interface Box {
  x0: number;
  y0: number;
  /** Inclusive. */
  x1: number;
  /** Inclusive. */
  y1: number;
}

export interface Cell extends Box {
  id: number;
  table: number;
  pixels: number;
  /** Dark pixels inside the cell (text). */
  ink: number;
  /** Brightly coloured pixels, e.g. a highlighter mark. */
  colored: number;
}

export interface Grid {
  width: number;
  height: number;
  /** Typical glyph height in pixels. */
  charH: number;
  gray: Uint8Array;
  dark: Uint8Array;
  colored: Uint8Array;
  /** Cell id + 1 for every pixel that belongs to a cell, 0 elsewhere. */
  cellMap: Int32Array;
  tables: (Box & { id: number })[];
  cells: Cell[];
}

interface Comp extends Box {
  count: number;
}

export const boxW = (b: Box) => b.x1 - b.x0 + 1;
export const boxH = (b: Box) => b.y1 - b.y0 + 1;

/** Two-pass connected-component labelling with union-find. Labels are 1-based (0 = background). */
function components(mask: Uint8Array, W: number, H: number, eight: boolean): { labels: Int32Array; comps: Comp[] } {
  const labels = new Int32Array(W * H);
  const parent = new Int32Array((W * H) / 2 + 2);
  let next = 1;
  const find = (a: number) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i]) continue;
      let l = 0;
      const consider = (j: number) => {
        const lj = labels[j];
        if (!lj) return;
        if (!l) l = lj;
        else if (lj !== l) union(l, lj);
      };
      if (x > 0) consider(i - 1);
      if (y > 0) {
        consider(i - W);
        if (eight) {
          if (x > 0) consider(i - W - 1);
          if (x < W - 1) consider(i - W + 1);
        }
      }
      if (!l) {
        l = next++;
        parent[l] = l;
      }
      labels[i] = l;
    }
  }

  const compact = new Int32Array(next);
  const comps: Comp[] = [];
  for (let l = 1; l < next; l++) {
    const r = find(l);
    if (!compact[r]) {
      comps.push({ x0: Infinity, y0: Infinity, x1: -1, y1: -1, count: 0 });
      compact[r] = comps.length;
    }
    compact[l] = compact[r];
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!labels[i]) continue;
      const id = compact[labels[i]];
      labels[i] = id;
      const c = comps[id - 1];
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      c.count++;
    }
  }
  return { labels, comps };
}

function median(values: number[], fallback: number) {
  if (values.length === 0) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const contains = (outer: Box, inner: Box) =>
  inner.x0 >= outer.x0 && inner.y0 >= outer.y0 && inner.x1 <= outer.x1 && inner.y1 <= outer.y1;

export function analyzeGrid(img: ImageData): Grid {
  const { width: W, height: H, data } = img;
  const N = W * H;

  const gray = new Uint8Array(N);
  const colored = new Uint8Array(N);
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    gray[i] = (r * 77 + g * 150 + b * 29) >> 8;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    colored[i] = mx - mn > 60 && mx > 140 ? 1 : 0;
  }

  // Adaptive threshold against the local mean, so uneven lighting and highlighter colours
  // don't turn into "ink" while thin grey ruling lines still do.
  const W1 = W + 1;
  const integral = new Uint32Array(W1 * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += gray[y * W + x];
      integral[(y + 1) * W1 + x + 1] = integral[y * W1 + x + 1] + row;
    }
  }
  const radius = Math.max(8, Math.round(Math.min(W, H) / 60));
  const dark = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    const ya = Math.max(0, y - radius);
    const yb = Math.min(H, y + radius + 1);
    for (let x = 0; x < W; x++) {
      const xa = Math.max(0, x - radius);
      const xb = Math.min(W, x + radius + 1);
      const sum = integral[yb * W1 + xb] - integral[ya * W1 + xb] - integral[yb * W1 + xa] + integral[ya * W1 + xa];
      const mean = sum / ((yb - ya) * (xb - xa));
      const v = gray[y * W + x];
      dark[y * W + x] = v < 60 || (v < mean * 0.85 && v < 215) ? 1 : 0;
    }
  }

  const { labels: darkLabels, comps: darkComps } = components(dark, W, H, true);

  const glyphHeights: number[] = [];
  for (const c of darkComps) {
    const w = boxW(c);
    const h = boxH(c);
    if (h >= 6 && h <= H / 10 && w <= h * 4 && c.count >= 10) glyphHeights.push(h);
  }
  const charH = median(glyphHeights, 14);

  // Ruling lines: long strokes (thin) or big connected grids. Words never get this long because
  // their letters aren't all connected.
  const isWall = new Uint8Array(darkComps.length + 1);
  const wallComps: Comp[] = [];
  darkComps.forEach((c, k) => {
    const w = boxW(c);
    const h = boxH(c);
    const long = Math.max(w, h) >= 8 * charH;
    const thin = Math.min(w, h) <= 0.6 * charH;
    const grid = w >= 4 * charH && h >= 4 * charH;
    if (long && (thin || grid)) {
      isWall[k + 1] = 1;
      wallComps.push(c);
    }
  });

  // Letters that touch a ruling line (descenders in tight rows) belong to the line's component.
  // Keep only long straight runs as walls so those letters stay inside their cell.
  const line = new Uint8Array(N);
  const minRun = Math.max(12, Math.round(2 * charH));
  const markRuns = (count: number, length: number, index: (a: number, b: number) => number) => {
    for (let a = 0; a < count; a++) {
      let start = -1;
      let last = -10;
      const close = () => {
        if (start >= 0 && last - start + 1 >= minRun) for (let b = start; b <= last; b++) line[index(a, b)] = 1;
      };
      for (let b = 0; b < length; b++) {
        if (!isWall[darkLabels[index(a, b)]]) continue;
        if (b - last > 2) {
          close();
          start = b;
        }
        last = b;
      }
      close();
    }
  };
  markRuns(H, W, (y, x) => y * W + x);
  markRuns(W, H, (x, y) => y * W + x);
  const wall = new Uint8Array(N);
  const grow = Math.max(1, Math.round(charH / 15));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!line[y * W + x]) continue;
      for (let dy = -grow; dy <= grow; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -grow; dx <= grow; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < W) wall[yy * W + xx] = 1;
        }
      }
    }
  }

  let tableBoxes = wallComps
    .filter((c) => boxW(c) >= 12 * charH && boxH(c) >= 3 * charH)
    .map((c) => ({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 }));
  tableBoxes = tableBoxes.filter((t, i) => !tableBoxes.some((o, j) => j !== i && contains(o, t) && !(contains(t, o) && j > i)));
  const tables = tableBoxes.map((t, id) => ({ ...t, id }));

  const cellMap = new Int32Array(N);
  const cells: Cell[] = [];
  const minSide = 0.8 * charH;

  for (const t of tables) {
    const tw = boxW(t);
    const th = boxH(t);
    const free = new Uint8Array(tw * th);
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) free[y * tw + x] = wall[(t.y0 + y) * W + t.x0 + x] ? 0 : 1;
    }
    const { labels, comps } = components(free, tw, th, false);
    const keep = new Int32Array(comps.length + 1);
    comps.forEach((c, k) => {
      const touchesEdge = c.x0 === 0 || c.y0 === 0 || c.x1 === tw - 1 || c.y1 === th - 1;
      if (touchesEdge || boxW(c) < minSide || boxH(c) < minSide) return;
      const cell: Cell = {
        id: cells.length,
        table: t.id,
        x0: c.x0 + t.x0,
        y0: c.y0 + t.y0,
        x1: c.x1 + t.x0,
        y1: c.y1 + t.y0,
        pixels: c.count,
        ink: 0,
        colored: 0,
      };
      cells.push(cell);
      keep[k + 1] = cell.id + 1;
    });
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const id = keep[labels[y * tw + x]];
        if (!id) continue;
        const i = (t.y0 + y) * W + t.x0 + x;
        cellMap[i] = id;
        const cell = cells[id - 1];
        if (dark[i]) cell.ink++;
        else if (colored[i]) cell.colored++;
      }
    }
  }

  return { width: W, height: H, charH, gray, dark, colored, cellMap, tables, cells };
}

/**
 * Renders one cell as a clean, upscaled grayscale image for OCR: pixels outside the cell and
 * highlighter colour are painted white.
 */
export function renderForOcr(grid: Grid, cell: Cell): HTMLCanvasElement {
  const w = boxW(cell);
  const h = boxH(cell);
  const src = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (cell.y0 + y) * grid.width + cell.x0 + x;
      let v = grid.gray[i];
      if (grid.cellMap[i] !== cell.id + 1) v = 255;
      else if (grid.colored[i] && !grid.dark[i]) v = 255;
      const p = (y * w + x) * 4;
      src.data[p] = src.data[p + 1] = src.data[p + 2] = v;
      src.data[p + 3] = 255;
    }
  }
  const raw = document.createElement("canvas");
  raw.width = w;
  raw.height = h;
  raw.getContext("2d")!.putImageData(src, 0, 0);

  // Tesseract reads best when capital letters are ~30-40px tall and the text has a margin.
  const scale = Math.min(4, Math.max(1, 34 / grid.charH));
  const pad = 12;
  const out = document.createElement("canvas");
  out.width = Math.round(w * scale) + pad * 2;
  out.height = Math.round(h * scale) + pad * 2;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(raw, pad, pad, w * scale, h * scale);
  return out;
}
