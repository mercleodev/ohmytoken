import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "electron/**/__tests__/**/*.spec.ts",
      "packages/**/__tests__/**/*.spec.ts",
    ],
    exclude: [
      "dist-electron/**",
      "node_modules/**",
      // backfill.spec.ts requires better-sqlite3 native module which hangs
      // outside Electron runtime. Run manually after electron-rebuild.
      "electron/backfill/__tests__/backfill.spec.ts",
    ],
    testTimeout: 10000,
  },
});
