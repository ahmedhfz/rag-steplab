import type { NextConfig } from "next";
import { shouldProxyRemoteApi } from "./lib/api-base-url";

const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim().replace(/\/$/, "");
const proxyRemoteApi = shouldProxyRemoteApi(configuredApiBaseUrl, process.env.NODE_ENV);
const configuredSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
const isVercelPreview = process.env.VERCEL === "1" && process.env.VERCEL_ENV === "preview";

function origin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

const connectOrigins = new Set<string>(["'self'"]);
if (isVercelPreview) connectOrigins.add("https://vercel.live");
for (const candidate of [origin(configuredApiBaseUrl), origin(configuredSupabaseUrl)]) {
  if (!candidate) continue;
  connectOrigins.add(candidate);
  if (candidate.startsWith("https://")) connectOrigins.add(candidate.replace("https://", "wss://"));
}
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}${isVercelPreview ? " https://vercel.live" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src ${[...connectOrigins].join(" ")}`,
  `frame-src 'self' blob:${isVercelPreview ? " https://vercel.live" : ""}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  // Projenin kendi AGENTS.md bağlamı korunmalı; Next'in otomatik kural eki kapatılıyor.
  agentRules: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    if (!proxyRemoteApi || !configuredApiBaseUrl) return [];

    return [
      {
        source: "/api/rag/:path*",
        destination: `${configuredApiBaseUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
