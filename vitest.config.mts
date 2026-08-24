import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    clearMocks: true,
    restoreMocks: true,
    // JSDOM + Motion + Radix yüzeyleri tek süreçte daha deterministik çalışır;
    // worker yarışları 5 sn'lik user-event testlerini yapay olarak aşabiliyor.
    maxWorkers: 1,
    minWorkers: 1,
  },
});
