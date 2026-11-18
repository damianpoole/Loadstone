import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const markerPrefix = "loadstone-owner-v1-";
const recognized = /^loadstone-owner-v1-[0-9a-f-]{36}$/;
const identify = async (path: string) => {
  const { dev, ino, birthtimeNs } = await lstat(path, { bigint: true });
  return `${dev}:${ino}:${birthtimeNs}`;
};
const locked = () =>
  Object.assign(new Error("This Loadstone data directory is already owned."), { code: "ELOCKED" });

/** OS-backed lock; unlike a heartbeat, cannot expire while its owner is suspended. */
export function acquireProcessLease(path: string) {
  const db = new DatabaseSync(path);
  try {
    db.exec("BEGIN IMMEDIATE");
  } catch (error) {
    db.close();
    if (error instanceof Error && "errcode" in error && error.errcode === 5) throw locked();
    throw error;
  }
  return () => db.close();
}

export async function acquireHomeLease(home: string, onCompromised: () => void) {
  const close = acquireProcessLease(join(home, ".home-owner.sqlite"));
  const path = join(home, ".tui.lock");
  const token = randomUUID();
  const marker = join(path, `${markerPrefix}${token}`);
  const retired = join(home, `.retired-lease-${token}`);
  const create = async () => {
    const started = Date.now();
    const monotonic = performance.now();
    await mkdir(path, { mode: 0o700 });
    const original = await identify(path);
    // The empty compatibility directory is visible during bootstrap. Never
    // adopt a directory observed after even the shortest legacy stale interval.
    if (Math.abs(Date.now() - started) >= 5000 || performance.now() - monotonic >= 5000)
      throw locked();
    await writeFile(marker, "", { flag: "wx", mode: 0o600 });
    if ((await identify(path).catch(() => undefined)) !== original) {
      // Remove only this attempt's unique marker, not the successor directory.
      await rm(marker, { force: true }).catch(() => {});
      throw locked();
    }
    return original;
  };
  let identity: string;
  try {
    try {
      identity = await create();
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      // We hold the OS lock. An unmarked legacy directory is not ours to reap.
      const previous = await readdir(path).catch(() => []);
      if (previous.length !== 1 || !recognized.test(previous[0])) throw locked();
      await rename(path, retired);
      await rm(retired, { recursive: true, force: true });
      identity = await create();
    }
  } catch (error) {
    close();
    throw error;
  }
  const assertOwned = async () => {
    if (
      (await identify(path).catch(() => undefined)) !== identity ||
      !(await lstat(marker).catch(() => undefined))
    )
      throw new Error("Exclusive storage ownership was lost.");
  };
  const check = setInterval(() => {
    void assertOwned().catch(() => {
      clearInterval(check);
      onCompromised();
    });
  }, 5000);
  check.unref();
  return async () => {
    clearInterval(check);
    try {
      await assertOwned();
      // The nonempty directory cannot be removed by legacy clients. Move it
      // atomically before cleanup, so we never unlink a successor at this path.
      await rename(path, retired);
      await rm(retired, { recursive: true, force: true });
    } finally {
      close();
    }
  };
}
