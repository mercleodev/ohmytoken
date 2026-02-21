import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["electron/**/__tests__/**/*.spec.ts"],
    testTimeout: 10000,
  },
});
