import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {},
  lint: {
    ignorePatterns: ["**/dist/**", "**/release/**"],
    rules: {
      "typescript/no-explicit-any": "error",
      "typescript/ban-ts-comment": ["error", { "ts-expect-error": "allow-with-description" }],
      "no-debugger": "error",
      "no-empty": "error",
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
});
