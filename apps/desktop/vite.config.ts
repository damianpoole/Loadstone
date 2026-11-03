import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/main.ts"],
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
