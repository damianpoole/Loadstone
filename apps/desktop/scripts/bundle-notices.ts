import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const piPackages = [
  "chord",
  "pi-agent-core",
  "pi-ai",
  "pi-codemode",
  "pi-coding-agent",
  "pi-durable",
  "pi-mcp",
  "pi-telemetry",
  "pi-tui",
];
const upstream = new Map([
  ...piPackages.map((name) => [`@earendil-works/${name}@1.4.0`, "pi-1.4.0.txt"] as const),
  ["boolbase@1.0.0", "boolbase-1.0.0.txt"],
  ["lazy-val@1.0.5", "lazy-val-1.0.5.txt"],
  ["standardwebhooks@1.1.1", "standardwebhooks-1.1.1.txt"],
]);
const licenseDir = fileURLToPath(new URL("../licenses/", import.meta.url));

const packageRoots = (ids: string[]) => {
  const roots = new Set<string>();
  for (const id of ids) {
    const path = id.split("?")[0];
    if (!isAbsolute(path) || !path.split(/[\\/]/).includes("node_modules")) continue;
    let root = dirname(path);
    // Nested package.json files are sometimes used only to override module type.
    while (root !== dirname(root)) {
      if (existsSync(join(root, "package.json"))) {
        const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
        if (typeof manifest.name === "string" && typeof manifest.version === "string") {
          roots.add(root);
          break;
        }
      }
      root = dirname(root);
    }
  }
  return roots;
};

/** Emit notices for packages with code actually present in a chunk. */
export function bundleNotices() {
  return {
    name: "loadstone-bundle-notices",
    generateBundle(
      this: { emitFile(asset: { type: "asset"; fileName: string; source: string }): string },
      _options: unknown,
      bundle: Record<
        string,
        { type: string; fileName: string; modules?: Record<string, { renderedLength: number }> }
      >,
    ) {
      const missing = new Set<string>();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk" || !chunk.modules) continue;
        const modules = Object.entries(chunk.modules)
          .filter(([, info]) => info.renderedLength > 0)
          .map(([id]) => id);
        const notices = [];
        for (const root of packageRoots(modules)) {
          const { name, version, license } = JSON.parse(
            readFileSync(join(root, "package.json"), "utf8"),
          );
          const files = readdirSync(root)
            .filter((file) => /^(licen[cs]e|copying|notice|copyright)([._-].*)?$/i.test(file))
            .sort();
          const texts = files.map(
            (file) => `--- ${file} ---\n${readFileSync(join(root, file), "utf8").trim()}`,
          );
          if (!texts.length) {
            const pinned = upstream.get(`${name}@${version}`);
            if (pinned) texts.push(readFileSync(join(licenseDir, pinned), "utf8").trim());
            else if (`${name}@${version}` === "data-uri-to-buffer@4.0.1") {
              const readme = readFileSync(join(root, "README.md"), "utf8");
              const start = readme.indexOf("(The MIT License)");
              if (start !== -1) texts.push(readme.slice(start).trim());
            }
          }
          if (!texts.length) missing.add(`${name}@${version} (${relative(process.cwd(), root)})`);
          notices.push(
            `${name}@${version} (${license ?? "see terms below"})\n${texts.join("\n\n")}`,
          );
        }
        // A separate notice per chunk preserves notices across all pack/build steps.
        if (notices.length) {
          this.emitFile({
            type: "asset",
            fileName: `${chunk.fileName}.NOTICES.txt`,
            source: `Third-party notices for ${chunk.fileName}\n\n${notices.sort().join("\n\n====================\n\n")}\n`,
          });
        }
      }
      if (missing.size)
        throw new Error(
          `Missing license texts for bundled packages:\n${[...missing].sort().join("\n")}`,
        );
    },
  };
}
