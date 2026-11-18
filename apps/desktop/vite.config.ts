import { defineConfig } from "vite-plus";
import { bundleNotices } from "./scripts/bundle-notices";

export default defineConfig({
  pack: {
    entry: ["src/main.ts", "src/launch.ts", "src/storage-worker.ts"],
    plugins: [bundleNotices()],
    format: ["cjs"],
    platform: "node",
    target: "node24",
    clean: true,
    dts: false,
    outExtensions: () => ({ js: ".cjs" }),
    // Self-contained backend: no workspace links or developer node_modules at runtime.
    deps: { alwaysBundle: [/.*/], neverBundle: ["electron"] },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
