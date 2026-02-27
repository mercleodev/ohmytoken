import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["electron/**/__tests__/**/*.spec.ts"],
    exclude: ["dist-electron/**", "node_modules/**"],
    testTimeout: 10000,
  },
});
