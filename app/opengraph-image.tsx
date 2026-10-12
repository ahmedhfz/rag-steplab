import { readFileSync } from "node:fs";
import path from "node:path";

import { ImageResponse } from "next/og";

import { UI_COPY } from "@/lib/copy";

// Statically generated at build time: no request data, no network, only the font bundled with next/og.
export const alt = "RAG StepLab: inspect every RAG step from PDF to answer.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Light theme tokens (app/globals.css); the image has no theme of its own.
const COLOR = {
  background: "#f8f7f7",
  card: "#ffffff",
  foreground: "#171416",
  muted: "#5a5357",
  border: "#e7e2e4",
  line: "#c9c2c5",
  brand: "#711f3a",
  brandBorder: "#e3a9b9",
} as const;

// Same names as the Overview journey and the login hero (English: the share card has no locale).
const JOURNEY = UI_COPY.en.overview.journey.steps;
// The same raster mark as the UI (components/brand-mark.tsx), embedded so the build needs no network.
const BRAND_MARK = `data:image/png;base64,${readFileSync(path.join(process.cwd(), "components/brand/rag-steplab-mark.png")).toString("base64")}`;
const STEPS = [JOURNEY.document, JOURNEY.parse, JOURNEY.chunk, JOURNEY.embed, JOURNEY.retrieve, JOURNEY.generate];

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          padding: "72px 80px",
          background: COLOR.background,
          color: COLOR.foreground,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- next/og renders intrinsic elements only */}
          <img alt="" height={64} src={BRAND_MARK} width={64} />
          <div style={{ fontSize: 36, letterSpacing: -0.5 }}>RAG StepLab</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 64, lineHeight: 1.1, letterSpacing: -1.5 }}>{UI_COPY.en.overview.title}</div>
          <div style={{ fontSize: 30, lineHeight: 1.35, color: COLOR.muted }}>{UI_COPY.en.auth.hero.description}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center" }}>
          {STEPS.map((step, index) => {
            const accent = index === STEPS.length - 1;
            return (
              <div key={step} style={{ display: "flex", alignItems: "center", flexGrow: index === 0 ? 0 : 1 }}>
                {index === 0 ? null : <div style={{ flexGrow: 1, minWidth: 16, height: 2, background: COLOR.line }} />}
                <div
                  style={{
                    padding: "12px 20px",
                    borderRadius: 12,
                    border: `2px solid ${accent ? COLOR.brandBorder : COLOR.border}`,
                    background: COLOR.card,
                    color: accent ? COLOR.brand : COLOR.foreground,
                    fontSize: 24,
                  }}
                >
                  {step}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    ),
    size,
  );
}
