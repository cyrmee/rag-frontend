// A chart the backend put in an answer: one ```chart fenced block holding
// this JSON (see rag-backend's app/charts.py - it validates, normalizes
// and grounds the block before it reaches us, so a block that arrives is
// complete and drawable). `unverified` lists values no cited source
// states; `sources` are 1-based indices into the done event's sources.
export type ChartType = "line" | "bar" | "pie" | "donut";

export type ChartSeries = {
  name: string;
  values: number[];
};

export type ChartSpec = {
  type: ChartType;
  title: string;
  labels: string[];
  series: ChartSeries[];
  unit?: string;
  sources: number[];
  unverified?: number[];
};

const CHART_TYPES: ChartType[] = ["line", "bar", "pie", "donut"];

// The backend already rejected anything malformed; this re-checks the
// shape anyway so a hand-edited or older conversation can't crash the
// renderer - a block that doesn't parse falls back to a plain code block.
export function parseChartSpec(text: string): ChartSpec | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (typeof obj.type !== "string" || !CHART_TYPES.includes(obj.type as ChartType)) return null;
  if (typeof obj.title !== "string" || !Array.isArray(obj.labels) || !Array.isArray(obj.series)) return null;
  const labels = obj.labels.map(String);
  const series: ChartSeries[] = [];
  for (const raw of obj.series) {
    if (!raw || typeof raw !== "object") return null;
    const s = raw as Record<string, unknown>;
    if (typeof s.name !== "string" || !Array.isArray(s.values)) return null;
    const values = s.values.map(Number);
    if (values.length !== labels.length || values.some((v) => !Number.isFinite(v))) return null;
    series.push({ name: s.name, values });
  }
  if (labels.length === 0 || series.length === 0) return null;
  const numbers = (value: unknown) =>
    Array.isArray(value) ? value.map(Number).filter((n) => Number.isFinite(n)) : [];
  return {
    type: obj.type as ChartType,
    title: obj.title,
    labels,
    series,
    unit: typeof obj.unit === "string" && obj.unit ? obj.unit : undefined,
    sources: numbers(obj.sources).map((n) => Math.trunc(n)),
    unverified: Array.isArray(obj.unverified) && obj.unverified.length ? numbers(obj.unverified) : undefined,
  };
}

// Compact axis ticks (0 / 1K / 2.5M); full precision in tooltips, tables
// and direct labels, where the reader wants the number as stated.
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return trim(value / 1e9) + "B";
  if (abs >= 1e6) return trim(value / 1e6) + "M";
  if (abs >= 1e3) return trim(value / 1e3) + "K";
  return trim(value);
}

function trim(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

export function formatValue(value: number, unit?: string): string {
  const text = Number.isInteger(value)
    ? value.toLocaleString("en-US")
    : value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return unit ? `${text} ${unit}` : text;
}

// "Nice" tick steps: 1, 2, 2.5, 5 x 10^n, with the axis always reaching
// zero so bars grow from a true baseline.
export function niceTicks(min: number, max: number, count = 5): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  if (hi === lo) return [0, 1];
  const span = hi - lo;
  const rough = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const step =
    (residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10) * magnitude;
  const ticks: number[] = [];
  for (let t = Math.floor(lo / step) * step; t <= hi + step * 0.5; t += step) {
    ticks.push(Math.round(t / step) * step);
  }
  return ticks;
}

// Series colours are the app's own chart tokens (globals.css: the Fayda
// brand hues, with their dark-theme values), so charts match the rest of
// the interface in either theme. Blue and sky are kept apart in the
// order, since they're close in the dark theme. A sixth series onward
// wears neutral steps and relies on the legend and the table. Values
// are CSS var() references; the PNG download resolves them to literal
// colours from the rendered chart.
export const CHART_SLOTS = [
  "var(--chart-1)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-2)",
  "var(--chart-5)",
  "color-mix(in oklch, var(--muted-foreground) 70%, var(--card))",
  "color-mix(in oklch, var(--muted-foreground) 45%, var(--card))",
  "color-mix(in oklch, var(--foreground) 60%, var(--card))",
];

export function seriesColor(index: number): string {
  return CHART_SLOTS[Math.min(index, CHART_SLOTS.length - 1)];
}
