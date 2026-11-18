import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { acquireHomeLease } from "./home-lease";

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, mkdir: vi.fn(fs.mkdir) };
});

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "loadstone lease "));
});
afterEach(async () => {
  vi.restoreAllMocks();
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
  await writeFile(join(path, "loadstone-owner-v1-00000000-0000-0000-0000-000000000000"), "");
  execFileSync(process.execPath, [
    "-e",
    "new (require('node:sqlite').DatabaseSync)(process.argv[1]).exec('BEGIN IMMEDIATE'); process.exit(0)",
    join(home, ".home-owner.sqlite"),
  ]);
  const release = await acquireHomeLease(home, vi.fn());
  await release();
  await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
});

it("does not mark a legacy lease acquired while modern bootstrap was paused", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(mkdir).mockImplementationOnce(async (path, options) => {
    const result = await actual.mkdir(path, options);
    execFileSync(process.execPath, [
      "-e",
      "const fs=require('node:fs'); const dir=process.argv[1]; fs.rmdirSync(dir); fs.mkdirSync(dir);",
      String(path),
    ]);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
    return result;
  });
  await expect(acquireHomeLease(home, vi.fn())).rejects.toMatchObject({ code: "ELOCKED" });
  expect(await readdir(join(home, ".tui.lock"))).toEqual([]);
});
