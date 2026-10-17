import type { AppLocale } from "@/lib/copy";

export type CountForms = { one: string; other: string };

const intlLocales: Record<AppLocale, string> = { en: "en-US", tr: "tr-TR" };

const EMPTY = "—";

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Locale-aware number with grouping, e.g. 12,345 (en) / 12.345 (tr). */
export function formatNumber(locale: AppLocale, value: number | null | undefined, options?: Intl.NumberFormatOptions): string {
  if (!finite(value)) return EMPTY;
  return new Intl.NumberFormat(intlLocales[locale], options).format(value);
}

/**
 * Count with a correctly inflected unit: `formatCount("en", 1, { one: "chunk", other: "chunks" })`
 * → "1 chunk". Turkish does not pluralise after a number, so both forms are usually equal.
 */
export function formatCount(locale: AppLocale, count: number, forms: CountForms): string {
  if (!finite(count)) return EMPTY;
  const category = new Intl.PluralRules(intlLocales[locale]).select(count);
  return `${formatNumber(locale, count)} ${category === "one" ? forms.one : forms.other}`;
}

/** Locale-aware "a and b" list: "100 chunks and 30,000 tokens" (en) / "100 chunk ve 30.000 token" (tr). */
export function formatList(locale: AppLocale, items: string[]): string {
  return new Intl.ListFormat(intlLocales[locale], { type: "conjunction" }).format(items);
}

/** Diagnostic score with fixed precision (metrics default to 2 decimals). */
export function formatScore(value: number | null | undefined, digits = 2): string {
  return finite(value) ? value.toFixed(digits) : EMPTY;
}

/** Duration: milliseconds below one second, otherwise seconds with one decimal. */
export function formatMs(locale: AppLocale, ms: number | null | undefined): string {
  if (!finite(ms) || ms < 0) return EMPTY;
  if (ms < 1000) return `${formatNumber(locale, Math.round(ms))} ms`;
  return `${formatNumber(locale, ms / 1000, { maximumFractionDigits: 1 })} s`;
}
