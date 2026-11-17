// Stage B: deterministic line/circle detection for reference images.
// Pure typed-array math (no DOM), so unit tests run without a canvas.
// Detected coordinates are returned in ORIGINAL image pixels.

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA bytes, row-major, 4 bytes per pixel. */
  data: Uint8ClampedArray | Uint8Array;
}

export interface DetectedLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
}

export interface DetectedCircle {
  cx: number;
  cy: number;
  r: number;
  score: number;
}

export interface DetectionResult {
  width: number;
  height: number;
  /** Detector working scale (1 = full resolution). */
  scale: number;
  lines: DetectedLine[];
  circles: DetectedCircle[];
}

export interface DetectionOptions {
  /** Longest working side; larger images are box-downscaled. */
  maxDimension?: number;
}

const MAX_EDGES = 60_000;
const MAX_CIRCLE_EDGES = 18_000;
const MAX_LINES = 32;
const MAX_CIRCLES = 12;

interface EdgeMap {
  xs: Float32Array;
  ys: Float32Array;
  dirs: Float32Array;
  mags: Float32Array;
  count: number;
}

function luma(data: ArrayLike<number>, pixel: number): number {
  const i = pixel * 4;
  return 0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0);
}

function downscaleGray(image: RgbaImage, maxDimension: number): {
  gray: Float32Array;
  width: number;
  height: number;
  scale: number;
} {
  const { width, height, data } = image;
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const gray = new Float32Array(w * h);
  if (w === width && h === height) {
    for (let i = 0; i < w * h; i++) gray[i] = luma(data, i);
    return { gray, width: w, height: h, scale: 1 };
  }
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor(y / scale);
    const sy1 = Math.max(sy0 + 1, Math.ceil((y + 1) / scale));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x / scale);
      const sx1 = Math.max(sx0 + 1, Math.ceil((x + 1) / scale));
      let sum = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1 && sy < height; sy++) {
        for (let sx = sx0; sx < sx1 && sx < width; sx++) {
          sum += luma(data, sy * width + sx);
          n++;
        }
      }
      gray[y * w + x] = n > 0 ? sum / n : 0;
    }
  }
  return { gray, width: w, height: h, scale };
}

function blur3(gray: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(gray.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += gray[yy * w + xx] ?? 0;
          n++;
        }
      }
      out[y * w + x] = n > 0 ? sum / n : 0;
    }
  }
  return out;
}

function sobelEdges(gray: Float32Array, w: number, h: number): EdgeMap {
  const mags = new Float32Array(w * h);
  const dirs = new Float32Array(w * h);
  let sum = 0;
  let sumSq = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = gray[i - w - 1] ?? 0;
      const tc = gray[i - w] ?? 0;
      const tr = gray[i - w + 1] ?? 0;
      const ml = gray[i - 1] ?? 0;
      const mr = gray[i + 1] ?? 0;
      const bl = gray[i + w - 1] ?? 0;
      const bc = gray[i + w] ?? 0;
      const br = gray[i + w + 1] ?? 0;
      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      const mag = Math.hypot(gx, gy);
      mags[i] = mag;
      dirs[i] = Math.atan2(gy, gx);
      sum += mag;
      sumSq += mag * mag;
    }
  }
  const pixels = Math.max(1, (w - 2) * (h - 2));
  const mean = sum / pixels;
  const variance = Math.max(0, sumSq / pixels - mean * mean);
  const threshold = Math.max(24, mean + Math.sqrt(variance) * 1.1);
  const cap = w * h;
  let xs = new Float32Array(cap);
  let ys = new Float32Array(cap);
  let edirs = new Float32Array(cap);
  let emags = new Float32Array(cap);
  let count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const mag = mags[i] ?? 0;
      if (mag < threshold) continue;
      xs[count] = x;
      ys[count] = y;
      edirs[count] = dirs[i] ?? 0;
      emags[count] = mag;
      count++;
    }
  }
  if (count > MAX_EDGES) {
    const order = Array.from({ length: count }, (_, i) => i).sort(
      (a, b) => (emags[b] ?? 0) - (emags[a] ?? 0),
    );
    const keep = order.slice(0, MAX_EDGES);
    const kx = new Float32Array(MAX_EDGES);
    const ky = new Float32Array(MAX_EDGES);
    const kd = new Float32Array(MAX_EDGES);
    const km = new Float32Array(MAX_EDGES);
    for (let i = 0; i < MAX_EDGES; i++) {
      const j = keep[i] ?? 0;
      kx[i] = xs[j] ?? 0;
      ky[i] = ys[j] ?? 0;
      kd[i] = edirs[j] ?? 0;
      km[i] = emags[j] ?? 0;
    }
    xs = kx;
    ys = ky;
    edirs = kd;
    emags = km;
    count = MAX_EDGES;
  } else {
    xs = xs.slice(0, count);
    ys = ys.slice(0, count);
    edirs = edirs.slice(0, count);
    emags = emags.slice(0, count);
  }
  return { xs, ys, dirs: edirs, mags: emags, count };
}

function detectLines(edge: EdgeMap, w: number, h: number): DetectedLine[] {
  const nTheta = 180;
  const diag = Math.ceil(Math.hypot(w, h));
  const nRho = 2 * diag + 1;
  const acc = new Uint32Array(nTheta * nRho);
  const cos = new Float32Array(nTheta);
  const sin = new Float32Array(nTheta);
  for (let t = 0; t < nTheta; t++) {
    const a = (t * Math.PI) / 180;
    cos[t] = Math.cos(a);
    sin[t] = Math.sin(a);
  }
  for (let i = 0; i < edge.count; i++) {
    const x = edge.xs[i] ?? 0;
    const y = edge.ys[i] ?? 0;
    for (let t = 0; t < nTheta; t++) {
      const rho = Math.round(x * (cos[t] ?? 0) + y * (sin[t] ?? 0)) + diag;
      if (rho >= 0 && rho < nRho) acc[t * nRho + rho] = (acc[t * nRho + rho] ?? 0) + 1;
    }
  }
  const minVotes = Math.max(10, Math.round(edge.count * 0.02));
  const cells: { t: number; r: number; v: number }[] = [];
  for (let t = 0; t < nTheta; t++) {
    for (let r = 0; r < nRho; r++) {
      const v = acc[t * nRho + r] ?? 0;
      if (v >= minVotes) cells.push({ t, r, v });
    }
  }
  cells.sort((a, b) => b.v - a.v);
  const peaks: { t: number; r: number; v: number }[] = [];
  for (const cell of cells) {
    const near = peaks.some((p) => {
      const dt = Math.min(Math.abs(p.t - cell.t), nTheta - Math.abs(p.t - cell.t));
      return dt <= 2 && Math.abs(p.r - cell.r) <= 3;
    });
    if (!near) peaks.push(cell);
    if (peaks.length >= 64) break;
  }
  const minLen = Math.max(10, Math.min(w, h) * 0.04);
  const gap = 6;
  const lines: DetectedLine[] = [];
  for (const peak of peaks) {
    const t = peak.t;
    const r0 = peak.r - diag;
    const c = cos[t] ?? 0;
    const s = sin[t] ?? 0;
    const ts: number[] = [];
    for (let i = 0; i < edge.count; i++) {
      const x = edge.xs[i] ?? 0;
      const y = edge.ys[i] ?? 0;
      if (Math.abs(x * c + y * s - r0) <= 1.6) ts.push(-x * s + y * c);
    }
    if (ts.length < 2) continue;
    ts.sort((a, b) => a - b);
    let start = ts[0] ?? 0;
    let prev = start;
    const segments: [number, number][] = [];
    for (let i = 1; i < ts.length; i++) {
      const v = ts[i] ?? 0;
      if (v - prev > gap) {
        if (prev - start >= minLen) segments.push([start, prev]);
        start = v;
      }
      prev = v;
    }
    if (prev - start >= minLen) segments.push([start, prev]);
    for (const [a, b] of segments) {
      lines.push({
        x1: r0 * c - a * s,
        y1: r0 * s + a * c,
        x2: r0 * c - b * s,
        y2: r0 * s + b * c,
        score: b - a,
      });
    }
  }
  lines.sort((a, b) => b.score - a.score);
  const kept: DetectedLine[] = [];
  for (const line of lines) {
    const duplicate = kept.some((k) => {
      const same =
        (Math.hypot(k.x1 - line.x1, k.y1 - line.y1) <= 6 &&
          Math.hypot(k.x2 - line.x2, k.y2 - line.y2) <= 6) ||
        (Math.hypot(k.x1 - line.x2, k.y1 - line.y2) <= 6 &&
          Math.hypot(k.x2 - line.x1, k.y2 - line.y1) <= 6);
      return same;
    });
    if (!duplicate) kept.push(line);
    if (kept.length >= MAX_LINES) break;
  }
  return kept;
}

function detectCircles(edge: EdgeMap, w: number, h: number): DetectedCircle[] {
  const minSide = Math.min(w, h);
  const rMin = Math.max(6, Math.round(minSide * 0.04));
  const rMax = Math.max(rMin + 4, Math.round(minSide * 0.45));
  const rStep = Math.max(1, Math.round((rMax - rMin) / 80));
  const cap = Math.min(edge.count, MAX_CIRCLE_EDGES);
  const acc = new Uint32Array(w * h);
  const dirCos = new Float32Array(cap);
  const dirSin = new Float32Array(cap);
  for (let i = 0; i < cap; i++) {
    const dir = edge.dirs[i] ?? 0;
    dirCos[i] = Math.cos(dir);
    dirSin[i] = Math.sin(dir);
  }
  for (let i = 0; i < cap; i++) {
    const x = edge.xs[i] ?? 0;
    const y = edge.ys[i] ?? 0;
    const c = dirCos[i] ?? 0;
    const s = dirSin[i] ?? 0;
    for (let r = rMin; r <= rMax; r += rStep) {
      for (const sign of [-1, 1]) {
        const cx = Math.round(x + sign * c * r);
        const cy = Math.round(y + sign * s * r);
        if (cx >= 0 && cx < w && cy >= 0 && cy < h) {
          acc[cy * w + cx] = (acc[cy * w + cx] ?? 0) + 1;
        }
      }
    }
  }
  const cells: { x: number; y: number; v: number }[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = acc[y * w + x] ?? 0;
      if (v >= 8) cells.push({ x, y, v });
    }
  }
  cells.sort((a, b) => b.v - a.v);
  const centers: { x: number; y: number; v: number }[] = [];
  for (const cell of cells) {
    const near = centers.some((p) => Math.hypot(p.x - cell.x, p.y - cell.y) <= 12);
    if (!near) centers.push(cell);
    if (centers.length >= 24) break;
  }
  const circles: DetectedCircle[] = [];
  for (const center of centers) {
    const hist = new Uint32Array(rMax + 3);
    for (let i = 0; i < cap; i++) {
      const d = Math.round(
        Math.hypot((edge.xs[i] ?? 0) - center.x, (edge.ys[i] ?? 0) - center.y),
      );
      if (d >= rMin && d <= rMax) hist[d] = (hist[d] ?? 0) + 1;
    }
    let bestR = 0;
    let bestCount = 0;
    for (let r = rMin; r <= rMax; r++) {
      const count =
        (hist[r - 1] ?? 0) + (hist[r] ?? 0) + (hist[r + 1] ?? 0);
      if (count > bestCount) {
        bestCount = count;
        bestR = r;
      }
    }
    if (bestR <= 0) continue;
    const bins = 36;
    const covered = new Uint8Array(bins);
    let inliers = 0;
    for (let i = 0; i < cap; i++) {
      const dx = (edge.xs[i] ?? 0) - center.x;
      const dy = (edge.ys[i] ?? 0) - center.y;
      const d = Math.hypot(dx, dy);
      if (Math.abs(d - bestR) > 1.8) continue;
      inliers++;
      const angle = Math.atan2(dy, dx);
      const bin = Math.min(
        bins - 1,
        Math.max(0, Math.floor(((angle + Math.PI) / (2 * Math.PI)) * bins)),
      );
      covered[bin] = 1;
    }
    let coveredCount = 0;
    for (const value of covered) coveredCount += value;
    const coverage = coveredCount / bins;
    const minInliers = Math.max(12, Math.round(2 * Math.PI * bestR * 0.2));
    if (inliers < minInliers || coverage < 0.35) continue;
    circles.push({
      cx: center.x,
      cy: center.y,
      r: bestR,
      score: inliers * coverage,
    });
  }
  circles.sort((a, b) => b.score - a.score);
  const kept: DetectedCircle[] = [];
  for (const circle of circles) {
    const duplicate = kept.some(
      (k) =>
        Math.hypot(k.cx - circle.cx, k.cy - circle.cy) <= 6 &&
        Math.abs(k.r - circle.r) <= 6,
    );
    if (!duplicate) kept.push(circle);
    if (kept.length >= MAX_CIRCLES) break;
  }
  return kept;
}

export function detectReferenceGeometry(
  image: RgbaImage,
  options: DetectionOptions = {},
): DetectionResult {
  if (
    !Number.isFinite(image.width) ||
    !Number.isFinite(image.height) ||
    image.width <= 0 ||
    image.height <= 0
  ) {
    throw new Error("image has no pixels");
  }
  const maxDimension = Math.max(64, Math.min(1600, options.maxDimension ?? 720));
  const scaled = downscaleGray(image, maxDimension);
  const blurred = blur3(scaled.gray, scaled.width, scaled.height);
  const edges = sobelEdges(blurred, scaled.width, scaled.height);
  const inv = 1 / scaled.scale;
  const lines = detectLines(edges, scaled.width, scaled.height).map((line) => ({
    x1: line.x1 * inv,
    y1: line.y1 * inv,
    x2: line.x2 * inv,
    y2: line.y2 * inv,
    score: line.score * inv,
  }));
  const circles = detectCircles(edges, scaled.width, scaled.height).map((circle) => ({
    cx: circle.cx * inv,
    cy: circle.cy * inv,
    r: circle.r * inv,
    score: circle.score,
  }));
  return { width: image.width, height: image.height, scale: scaled.scale, lines, circles };
}
