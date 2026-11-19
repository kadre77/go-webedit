import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

// In-process tests of the frontend's modules, in Node with no DOM. Under
// vitest, vite-plugin-solid resolves Solid to its browser build, so effects
// run as they do in the app (the restore tests depend on it).
export default defineConfig({
  plugins: [solid()],
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
