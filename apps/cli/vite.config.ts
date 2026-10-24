import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    format: ["cjs"],
    outExtensions: () => ({ js: ".js" }),
    clean: true,
    platform: "node",
    target: "node24",
    banner: { js: "#!/usr/bin/env node" },
    onSuccess: "chmod +x dist/index.js",
    deps: { alwaysBundle: [/.*/] },
    dts: false,
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
