import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

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
    // worker yarışları user-event testlerini yapay olarak yavaşlatabiliyor.
    maxWorkers: 1,
    // İzole koşuda ~3 sn süren user-event testleri yük altında 5 sn varsayılanını aşıyordu.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // Bu dosyaları testler import etmeden readFileSync ile okur; `--changed` modül grafiği
    // onları göremez. Değişirlerse tüm suite koşar.
    forceRerunTriggers: [
      ...configDefaults.forceRerunTriggers,
      "**/public/samples/**",
      "**/app/globals.css",
      "**/app/**/page.tsx",
    ],
  },
});
