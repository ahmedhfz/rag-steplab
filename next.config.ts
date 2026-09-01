import type { NextConfig } from "next";
import { shouldProxyRemoteApi } from "./lib/api-base-url";

const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim().replace(/\/$/, "");
const proxyRemoteApi = shouldProxyRemoteApi(configuredApiBaseUrl, process.env.NODE_ENV);

const nextConfig: NextConfig = {
  // Projenin kendi AGENTS.md bağlamı korunmalı; Next'in otomatik kural eki kapatılıyor.
  agentRules: false,
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
