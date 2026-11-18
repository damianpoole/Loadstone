import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const marker = "loadstone-owner-v1";
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
  const retired = join(home, `.retired-lease-${token}`);
  const assertOwned = async () => {
    if ((await readFile(join(path, marker), "utf8").catch(() => undefined)) !== token)
      throw new Error("Exclusive storage ownership was lost.");
  };
  try {
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      // We hold the OS lock, so only a crashed modern owner can have left this
      // marker. An unmarked legacy directory must never be reaped by this code.
      const previous = await readFile(join(path, marker), "utf8").catch(() => "");
      if (!/^[0-9a-f-]{36}$/.test(previous)) throw locked();
      await rename(path, retired);
      await rm(retired, { recursive: true, force: true });
      await mkdir(path, { mode: 0o700 });
    }
    await writeFile(join(path, marker), token, { flag: "wx", mode: 0o600 });
  } catch (error) {
    close();
    throw error;
  }
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
