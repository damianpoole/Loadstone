import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { acquireHomeLease } from "./home-lease";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "loadstone lease "));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

it("does not expire or delete a replacement directory on close", async () => {
  const compromised = vi.fn();
  const release = await acquireHomeLease(home, compromised);
  await expect(acquireHomeLease(home, vi.fn())).rejects.toMatchObject({ code: "ELOCKED" });
  const path = join(home, ".tui.lock");
  await rename(path, join(home, "displaced"));
  await mkdir(path);
  await writeFile(join(path, "successor"), "keep this");
  await expect(release()).rejects.toThrow("ownership was lost");
  expect(compromised).not.toHaveBeenCalled();
  expect(await readFile(join(path, "successor"), "utf8")).toBe("keep this");
});

it("recovers a marked lock after a process exits without touching an unmarked legacy lease", async () => {
  const path = join(home, ".tui.lock");
  await mkdir(path);
  await expect(acquireHomeLease(home, vi.fn())).rejects.toMatchObject({ code: "ELOCKED" });
  await writeFile(join(path, "loadstone-owner-v1"), "00000000-0000-0000-0000-000000000000");
  execFileSync(process.execPath, [
    "-e",
    "new (require('node:sqlite').DatabaseSync)(process.argv[1]).exec('BEGIN IMMEDIATE'); process.exit(0)",
    join(home, ".home-owner.sqlite"),
  ]);
  const release = await acquireHomeLease(home, vi.fn());
  await release();
  await expect(readFile(join(path, "loadstone-owner-v1"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
