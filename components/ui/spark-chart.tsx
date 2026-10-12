"use client";

import { useId, type ComponentProps } from "react";

import { chartColors, type ChartColor } from "@/components/ui/chart-colors";
import { cn } from "@/lib/utils";

/*
 * Spark charts — props follow Tremor Raw SparkChart v1.0.0 (Apache-2.0, github.com/tremorlabs/tremor:
 * data / index / categories / colors). The rendering is a dependency-free SVG written for
 * StepLab instead of Tremor's Recharts implementation (Recharts would add ~100 kB for sparklines).
 * Decorative by default: pass `aria-label` with the takeaway ("Latency trending down, 820 → 610 ms").
 */

type Datum = Record<string, unknown>;

export type SparkChartProps = Omit<ComponentProps<"svg">, "children"> & {
  data: ReadonlyArray<Datum>;
  /** Key of the x value (kept for API parity; points are evenly spaced). */
  index: string;
  categories: ReadonlyArray<string>;
  colors?: ReadonlyArray<ChartColor>;
  minValue?: number;
  maxValue?: number;
};

const W = 100;
const H = 32;
const PAD = 2;

function series(data: ReadonlyArray<Datum>, key: string) {
  return data.map((row) => (typeof row[key] === "number" ? (row[key] as number) : null));
}

function domain(data: ReadonlyArray<Datum>, categories: ReadonlyArray<string>, minValue?: number, maxValue?: number) {
  const values = categories.flatMap((key) => series(data, key)).filter((v): v is number => v !== null);
  const min = minValue ?? Math.min(...values, 0);
  const max = maxValue ?? Math.max(...values, 1);
  return { min, max: max === min ? min + 1 : max };
}

function points(values: Array<number | null>, min: number, max: number) {
  const step = values.length > 1 ? (W - PAD * 2) / (values.length - 1) : 0;
  return values.map((v, i) => (v === null ? null : [PAD + i * step, H - PAD - ((v - min) / (max - min)) * (H - PAD * 2)] as const));
}

function linePath(pts: ReturnType<typeof points>) {
  let d = "";
  let pen = false;
  for (const p of pts) {
    if (!p) { pen = false; continue; }
    d += `${pen ? "L" : "M"}${p[0].toFixed(2)},${p[1].toFixed(2)} `;
    pen = true;
  }
  return d.trim();
}

/** `index` is accepted for Tremor API parity but is not a DOM attribute. */
function withoutIndex<T extends { index?: string }>(props: T) {
  const copy: Partial<T> = { ...props };
  delete copy.index;
  return copy as Omit<T, "index">;
}

function Svg({ className, children, ...props }: ComponentProps<"svg">) {
  const labelled = Boolean(props["aria-label"]);
  return (
    <svg aria-hidden={labelled ? undefined : true} className={cn("h-8 w-28 overflow-visible", className)} preserveAspectRatio="none" role={labelled ? "img" : undefined} viewBox={`0 0 ${W} ${H}`} {...props}>
      {children}
    </svg>
  );
}

export function SparkLineChart({ data, categories, colors = ["brand", "gray"], minValue, maxValue, ...rest }: SparkChartProps) {
  const { min, max } = domain(data, categories, minValue, maxValue);
  return (
    <Svg {...withoutIndex(rest)} data-slot="spark-line">
      {categories.map((key, i) => {
        const pts = points(series(data, key), min, max);
        const last = [...pts].reverse().find(Boolean);
        const tone = chartColors[colors[i % colors.length]];
        return (
          <g key={key}>
            <path className={cn("fill-none", tone.stroke)} d={linePath(pts)} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
            {last && i === 0 ? <circle className={tone.fill} cx={last[0]} cy={last[1]} r={1.6} /> : null}
          </g>
        );
      })}
    </Svg>
  );
}

export function SparkAreaChart({ data, categories, colors = ["brand", "gray"], minValue, maxValue, ...rest }: SparkChartProps) {
  const id = useId();
  const { min, max } = domain(data, categories, minValue, maxValue);
  return (
    <Svg {...withoutIndex(rest)} data-slot="spark-area">
      {categories.map((key, i) => {
        const pts = points(series(data, key), min, max).filter((p): p is readonly [number, number] => p !== null);
        if (pts.length === 0) return null;
        const tone = chartColors[colors[i % colors.length]];
        const gradient = `${id}-${i}`.replace(/:/g, "");
        const line = pts.map((p, j) => `${j ? "L" : "M"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ");
        const area = `${line} L${pts[pts.length - 1][0].toFixed(2)},${H} L${pts[0][0].toFixed(2)},${H} Z`;
        return (
          <g key={key}>
            <defs>
              <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
                <stop className={tone.text} offset="0%" stopColor="currentColor" stopOpacity={0.28} />
                <stop className={tone.text} offset="100%" stopColor="currentColor" stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={area} fill={`url(#${gradient})`} />
            <path className={cn("fill-none", tone.stroke)} d={line} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
    </Svg>
  );
}

export function SparkBarChart({ data, categories, colors = ["brand", "gray"], minValue, maxValue, ...rest }: SparkChartProps) {
  const { min, max } = domain(data, categories, Math.min(minValue ?? 0, 0), maxValue);
  const groups = data.length || 1;
  const slot = (W - PAD * 2) / groups;
  const barWidth = Math.max((slot * 0.7) / categories.length, 0.5);
  const zero = H - PAD - ((0 - min) / (max - min)) * (H - PAD * 2);
  return (
    <Svg {...withoutIndex(rest)} data-slot="spark-bar">
      {data.map((row, g) =>
        categories.map((key, i) => {
          const v = typeof row[key] === "number" ? (row[key] as number) : null;
          if (v === null) return null;
          const y = H - PAD - ((v - min) / (max - min)) * (H - PAD * 2);
          const tone = chartColors[colors[i % colors.length]];
          return <rect className={tone.fill} height={Math.max(Math.abs(zero - y), 0.5)} key={`${g}-${key}`} rx={0.6} width={barWidth} x={PAD + g * slot + slot * 0.15 + i * barWidth} y={Math.min(y, zero)} />;
        }),
      )}
    </Svg>
  );
}
