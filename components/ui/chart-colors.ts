/*
 * Chart colours for the Tremor-derived visualisations. Deliberately semantic and few:
 * data ink is gray unless it means something (brand = the series you are looking at now,
 * success/warning/error = verified good / caution / failed).
 * Derived from Tremor Raw `utils/chartColors.ts` (Apache-2.0, github.com/tremorlabs/tremor), modified.
 */

export type ChartColor = "brand" | "gray" | "success" | "warning" | "error";

export const chartColors: Record<ChartColor, { solid: string; tint: string; tintHover: string; stroke: string; fill: string; text: string }> = {
  brand: { solid: "bg-fg-brand-primary", tint: "bg-utility-brand-100", tintHover: "group-hover:bg-utility-brand-200", stroke: "stroke-fg-brand-primary", fill: "fill-fg-brand-primary", text: "text-fg-brand-primary" },
  gray: { solid: "bg-fg-quaternary", tint: "bg-utility-gray-100", tintHover: "group-hover:bg-utility-gray-200", stroke: "stroke-fg-tertiary", fill: "fill-fg-tertiary", text: "text-fg-tertiary" },
  success: { solid: "bg-fg-success-secondary", tint: "bg-utility-success-100", tintHover: "group-hover:bg-utility-success-200", stroke: "stroke-fg-success-primary", fill: "fill-fg-success-primary", text: "text-fg-success-primary" },
  warning: { solid: "bg-fg-warning-secondary", tint: "bg-utility-warning-100", tintHover: "group-hover:bg-utility-warning-200", stroke: "stroke-fg-warning-primary", fill: "fill-fg-warning-primary", text: "text-fg-warning-primary" },
  error: { solid: "bg-fg-error-secondary", tint: "bg-utility-error-100", tintHover: "group-hover:bg-utility-error-200", stroke: "stroke-fg-error-primary", fill: "fill-fg-error-primary", text: "text-fg-error-primary" },
};
