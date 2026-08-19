import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Projenin kendi AGENTS.md bağlamı korunmalı; Next'in otomatik kural eki kapatılıyor.
  agentRules: false,
};

export default nextConfig;
