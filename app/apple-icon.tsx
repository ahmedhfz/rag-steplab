import { ImageResponse } from "next/og";

import { brandMarkShapes } from "@/components/brand-mark";

// Same mark as app/icon.svg; iOS applies its own corner mask, so the tile is square.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", background: "#711f3a" }}>
        {/* Shifted 28×28 box: centers the flask body (y 3.5–22.7) on the tile. */}
        <svg fill="none" height={136} viewBox="0 -0.9 28 28" width={136}>
          {brandMarkShapes("#ffffff", 1.6)}
        </svg>
      </div>
    ),
    size,
  );
}
