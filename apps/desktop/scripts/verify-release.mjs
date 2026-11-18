// Fail the signed-candidate job if it cannot feed the packaged stable updater.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const windows = process.platform === "win32";
const output = process.argv[2]
  ? pathToFileURL(resolve(process.argv[2]) + sep)
  : new URL("../release/", import.meta.url);
const resources = new URL(
  windows ? "win-unpacked/resources/" : "mac-arm64/Loadstone.app/Contents/Resources/",
  output,
);
const config = parse(await readFile(new URL("app-update.yml", resources), "utf8"));
const policy = JSON.parse(await readFile(new URL("loadstone-stable.json", resources), "utf8"));
assert.deepEqual(
  [config.provider, config.owner, config.repo, config.private, config.channel],
  ["github", "damianpoole", "Loadstone", false, "latest"],
);
assert.equal(policy.version, version);
if (windows) assert.deepEqual(config.publisherName, [policy.publisher]);

const notices = await readdir(new URL("third-party-notices/", resources), { recursive: true });
assert.ok(notices.includes("main.cjs.NOTICES.txt"), "main-process notices shipped");
assert.ok(
  notices.some(
    (path) => path.startsWith(join("renderer", "assets")) && path.endsWith(".NOTICES.txt"),
  ),
  "renderer notices shipped",
);

const metadata = parse(
  await readFile(new URL(windows ? "latest.yml" : "latest-mac.yml", output), "utf8"),
);
assert.equal(metadata.version, version);
const payload = `Loadstone-${version}-${windows ? "x64.exe" : "arm64.zip"}`;
assert.deepEqual(
  metadata.files.map(({ url }) => url),
  [payload],
);
for (const file of metadata.files) {
  assert.equal(file.url, basename(file.url));
  const path = new URL(file.url, output);
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  assert.equal(file.size, (await stat(path)).size);
  assert.equal(file.sha512, hash.digest("base64"));
  assert.equal(metadata.sha512, file.sha512);
}
console.log(
  "Stable provider configuration, shipped notices and update artifact checksums verified.",
);
