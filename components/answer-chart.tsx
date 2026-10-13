"use client";

import { createContext, useContext, useId, useRef, useState } from "react";
import { DownloadIcon, TableIcon } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AskSource } from "@/lib/api";
import { formatCompact, formatValue, seriesColor, type ChartSpec } from "@/lib/charts";
import { Button } from "@/components/ui/button";
import { focusSource, sourceHref } from "@/lib/source-focus";

// The sources of the turn a chart belongs to, and that turn's message id,
// so its "[n]" chips open the source in the list under the answer like
// the citations in the prose do. Provided by the assistant message around
// its markdown; absent (an answer saved without its sources) the chips
// are plain text.
export const ChartSourcesContext = createContext<{ sources?: AskSource[]; messageId?: string }>({});

// Everything the SVG is drawn with comes from the app's theme tokens,
// so a chart follows the interface in either theme. The PNG download
// resolves these to the rendered colours before serializing.
const INK = {
  text: "var(--foreground)",
  muted: "var(--muted-foreground)",
  grid: "var(--border)",
  surface: "var(--card)",
};

const HEIGHT = 240;
const TICK = { fontSize: 11, fontFamily: "var(--font-sans), ui-sans-serif, system-ui, sans-serif" };

// A copy of the chart's SVG with every var()/color-mix() colour replaced
// by the colour the browser actually rendered, so it draws the same when
// rasterized outside the page's stylesheet.
function resolvedSvgCopy(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const originals = [svg, ...Array.from(svg.querySelectorAll<SVGElement>("*"))];
  const copies = [clone, ...Array.from(clone.querySelectorAll<SVGElement>("*"))];
  copies.forEach((copy, i) => {
    const computed = getComputedStyle(originals[i]);
    for (const attr of ["fill", "stroke"] as const) {
      const value = copy.getAttribute(attr);
      if (value && /var\(|color-mix\(/.test(value)) copy.setAttribute(attr, computed[attr]);
    }
    const style = copy.getAttribute("style");
    if (style && /var\(|color-mix\(/.test(style)) {
      copy.setAttribute("style", `font-family: ${computed.fontFamily}; font-size: ${computed.fontSize}`);
    }
  });
  return clone;
}

export function AnswerChart({ spec }: { spec: ChartSpec }) {
  const ink = INK;
  const { sources, messageId } = useContext(ChartSourcesContext);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showTable, setShowTable] = useState(false);
  const titleId = useId();
  const isRound = spec.type === "pie" || spec.type === "donut";
  const colors = spec.series.map((_, i) => seriesColor(i));

  // Recharts wants one row per label with a key per series.
  const rows = spec.labels.map((label, i) => {
    const row: Record<string, string | number> = { label };
    spec.series.forEach((s) => {
      row[s.name] = s.values[i];
    });
    return row;
  });

  const download = () => {
    const svg = containerRef.current?.querySelector<SVGSVGElement>("svg.recharts-surface");
    const figure = containerRef.current;
    if (!svg || !figure) return;
    const clone = resolvedSvgCopy(svg);
    const surface = getComputedStyle(figure).backgroundColor;
    const w = svg.clientWidth || 560;
    const h = svg.clientHeight || HEIGHT;
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = h * scale;
    const context = canvas.getContext("2d");
    if (!context) return;
    const image = new Image();
    const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" })
    );
    image.onload = () => {
      context.fillStyle = surface;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const link = document.createElement("a");
      link.download = `${spec.title.replace(/[^\w\d-]+/g, "-").replace(/^-|-$/g, "") || "chart"}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    };
    image.src = url;
  };

  const tooltip = (
    <Tooltip
      isAnimationActive={false}
      cursor={
        spec.type === "line"
          ? { stroke: ink.muted, strokeWidth: 1 }
          : spec.type === "bar"
            ? { fill: ink.grid, fillOpacity: 0.5 }
            : false
      }
      content={({ active, payload, label }) => {
        if (!active || !payload?.length) return null;
        const total = isRound ? spec.series[0].values.reduce((a, b) => a + Math.max(0, b), 0) : 0;
        return (
          <div className="answer-chart-tip" role="status">
            <div className="answer-chart-tip-label">{isRound ? String(payload[0].name) : String(label)}</div>
            {payload.map((entry, i) => {
              const value = Number(entry.value);
              return (
                <div key={`${String(entry.name)}-${i}`} className="answer-chart-tip-row">
                  <span
                    className="answer-chart-key"
                    data-shape={spec.type === "line" ? "line" : "rect"}
                    style={{ background: isRound ? seriesColor(Number(entry.payload?.index ?? i)) : String(entry.color) }}
                    aria-hidden="true"
                  />
                  <strong>{formatValue(value, spec.unit)}</strong>
                  {isRound ? (
                    <span>{total > 0 ? `${Math.round((Math.max(0, value) / total) * 100)}%` : ""}</span>
                  ) : (
                    spec.series.length > 1 && <span>{String(entry.name)}</span>
                  )}
                </div>
              );
            })}
          </div>
        );
      }}
    />
  );

  return (
    <figure className="answer-chart" ref={containerRef} aria-labelledby={titleId}>
      <figcaption className="answer-chart-head">
        <span id={titleId} className="answer-chart-title">
          {spec.title}
        </span>
        <span className="answer-chart-actions">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setShowTable((v) => !v)}
            aria-pressed={showTable}
            aria-label={showTable ? "Hide the data table" : "Show the data table"}
            title={showTable ? "Hide data" : "Show data"}
          >
            <TableIcon />
            Data
          </Button>
          <Button variant="ghost" size="xs" onClick={download} aria-label="Download as PNG" title="Download PNG">
            <DownloadIcon />
            PNG
          </Button>
        </span>
      </figcaption>

      <div className="answer-chart-plot" role="img" aria-label={`${spec.type} chart: ${spec.title}`}>
        <ResponsiveContainer width="100%" height={HEIGHT} initialDimension={{ width: 560, height: HEIGHT }}>
          {spec.type === "line" ? (
            <LineChart data={rows} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={ink.grid} />
              <XAxis dataKey="label" tick={{ ...TICK, fill: ink.muted }} tickLine={false} axisLine={{ stroke: ink.grid }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis tickFormatter={formatCompact} tick={{ ...TICK, fill: ink.muted }} tickLine={false} axisLine={false} width={48} />
              {tooltip}
              {spec.series.map((s, i) => (
                <Line
                  key={s.name}
                  type="linear"
                  dataKey={s.name}
                  stroke={colors[i]}
                  strokeWidth={2}
                  dot={{ r: 4, fill: colors[i], stroke: ink.surface, strokeWidth: 2 }}
                  activeDot={{ r: 5, fill: colors[i], stroke: ink.surface, strokeWidth: 2 }}
                  isAnimationActive={false}
                >
                  {spec.series.length === 1 && <ExtremeLabel values={s.values} ink={ink} offset={-10} />}
                </Line>
              ))}
            </LineChart>
          ) : spec.type === "bar" ? (
            <BarChart data={rows} margin={{ top: 16, right: 16, bottom: 0, left: 0 }} barGap={2} barCategoryGap="25%">
              <CartesianGrid vertical={false} stroke={ink.grid} />
              <XAxis dataKey="label" tick={{ ...TICK, fill: ink.muted }} tickLine={false} axisLine={{ stroke: ink.grid }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis tickFormatter={formatCompact} tick={{ ...TICK, fill: ink.muted }} tickLine={false} axisLine={false} width={48} />
              {tooltip}
              {spec.series.map((s, i) => (
                <Bar
                  key={s.name}
                  dataKey={s.name}
                  fill={colors[i]}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={24}
                  activeBar={{ fillOpacity: 0.8 }}
                  isAnimationActive={false}
                >
                  {spec.series.length === 1 && <ExtremeLabel values={s.values} ink={ink} offset={-6} />}
                </Bar>
              ))}
            </BarChart>
          ) : (
            <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              {tooltip}
              <Pie
                data={spec.labels.map((label, index) => ({ label, index, value: Math.max(0, spec.series[0].values[index]) }))}
                dataKey="value"
                nameKey="label"
                innerRadius={spec.type === "donut" ? "58%" : 0}
                outerRadius="92%"
                stroke={ink.surface}
                strokeWidth={2}
                startAngle={90}
                endAngle={-270}
                isAnimationActive={false}
              >
                {spec.labels.map((label, i) => (
                  <Cell key={`${label}-${i}`} fill={seriesColor(i)} />
                ))}
              </Pie>
            </PieChart>
          )}
        </ResponsiveContainer>
        {spec.type === "donut" && (
          <div className="answer-chart-center" aria-hidden="true">
            <strong>{formatCompact(spec.series[0].values.reduce((a, b) => a + Math.max(0, b), 0))}</strong>
            <span>total{spec.unit ? ` (${spec.unit})` : ""}</span>
          </div>
        )}
      </div>

      {(spec.series.length > 1 || isRound) && (
        <ul className="answer-chart-legend" aria-label="Legend">
          {(isRound ? spec.labels : spec.series.map((s) => s.name)).map((name, i) => (
            <li key={`${name}-${i}`}>
              <span
                className="answer-chart-key"
                data-shape={spec.type === "line" ? "line" : "rect"}
                style={{ background: isRound ? seriesColor(i) : colors[i] }}
                aria-hidden="true"
              />
              {name}
            </li>
          ))}
        </ul>
      )}

      {spec.unverified && spec.unverified.length > 0 && (
        <p className="answer-chart-note" role="note">
          Values not confirmed in the cited sources: {spec.unverified.map((v) => formatValue(v)).join(", ")}
        </p>
      )}

      {spec.sources.length > 0 && (
        <p className="answer-chart-sources">
          From{" "}
          {spec.sources.map((n) => {
            const source = sources?.[n - 1];
            const label = `[${n}]`;
            return source && messageId ? (
              <a
                key={n}
                href={sourceHref(messageId, n)}
                onClick={(e) => {
                  e.preventDefault();
                  focusSource(messageId, n);
                }}
                title={source.filename}
                className="chat-citation-link"
              >
                {label}
              </a>
            ) : (
              <span key={n} className="chat-citation-link">
                {label}
              </span>
            );
          })}
        </p>
      )}

      {showTable && (
        <table className="answer-chart-table">
          <thead>
            <tr>
              <th scope="col">{isRound ? "Category" : ""}</th>
              {spec.series.map((s) => (
                <th key={s.name} scope="col">
                  {s.name}
                  {spec.unit ? ` (${spec.unit})` : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.labels.map((label, i) => (
              <tr key={`${label}-${i}`}>
                <th scope="row">{label}</th>
                {spec.series.map((s) => (
                  <td key={s.name}>{formatValue(s.values[i])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </figure>
  );
}

// A single series gets one direct label, on its highest point; every
// other value lives in the tooltip and the table.
function ExtremeLabel({ values, ink, offset }: { values: number[]; ink: typeof INK; offset: number }) {
  const maxIndex = values.indexOf(Math.max(...values));
  return (
    <LabelList
      dataKey={(row: unknown) => (row as Record<string, number>).__never__ ?? 0}
      content={(props) => {
        const { x, y, width, index } = props as { x?: number; y?: number; width?: number; index?: number };
        if (index !== maxIndex || x == null || y == null) return null;
        // A point on either edge anchors its label inward so it isn't
        // clipped by the plot's edge.
        const anchor = width ? "middle" : index === 0 ? "start" : index === values.length - 1 ? "end" : "middle";
        return (
          <text
            x={Number(x) + (Number(width) || 0) / 2}
            y={Number(y) + offset}
            textAnchor={anchor}
            fill={ink.text}
            fontSize={11}
            fontWeight={600}
          >
            {formatValue(values[maxIndex])}
          </text>
        );
      }}
    />
  );
}
