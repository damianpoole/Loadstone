import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  clean: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  onSuccess: "chmod +x dist/index.js",
  noExternal: ["@loadstone/wiki-client", "commander", "chalk", "cheerio"], // Bundle these dependencies
});
