import { defineConfig } from "vite-plus";
import { bundleNotices } from "./scripts/bundle-notices";

export default defineConfig({
  root: "src/renderer",
  plugins: [bundleNotices()],
  base: "./",
  build: { outDir: "../../dist/renderer", emptyOutDir: false },
});
