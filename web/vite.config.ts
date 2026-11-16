import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  build: {
    outDir: "dist",
    // Clears dist, including dist/.gitkeep; the build script puts it back so
    // the Go embed directive always has a directory.
    emptyOutDir: true,
    assetsDir: "assets",
  },
  server: {
    proxy: { "/api": "http://localhost:8080" },
  },
});
