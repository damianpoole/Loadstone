import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.tsx"],
    format: ["esm"],
    platform: "node",
    target: "node24",
    clean: true,
    dts: false,
    outExtensions: () => ({ js: ".js" }),
    banner: { js: "#!/usr/bin/env node" },
    // Bundle workspace source and its dependencies; keep Ink/React external.
    deps: { alwaysBundle: [/^@loadstone\//] },
    onSuccess: "chmod +x dist/index.js",
  },
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"] },
});
