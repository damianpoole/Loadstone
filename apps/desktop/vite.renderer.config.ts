import { defineConfig } from "vite-plus";

export default defineConfig({
  root: "src/renderer",
  base: "./",
  build: { outDir: "../../dist/renderer", emptyOutDir: false },
});
