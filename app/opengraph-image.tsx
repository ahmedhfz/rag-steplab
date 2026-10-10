import { ImageResponse } from "next/og";

import { BRAND_MARK_VIEWBOX, brandMarkShapes } from "@/components/brand-mark";

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

const STEPS = ["Document", "Parsing", "Chunking", "Embedding", "Retrieval", "Answer"] as const;

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
          <svg fill="none" height={56} viewBox={BRAND_MARK_VIEWBOX} width={56}>
            {brandMarkShapes(COLOR.brand)}
          </svg>
          <div style={{ fontSize: 36, letterSpacing: -0.5 }}>RAG StepLab</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 64, lineHeight: 1.1, letterSpacing: -1.5 }}>Build your RAG, one step at a time.</div>
          <div style={{ fontSize: 30, lineHeight: 1.35, color: COLOR.muted }}>
            From PDF to answer: inspect parsing, chunks, retrieval, and sources.
          </div>
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
