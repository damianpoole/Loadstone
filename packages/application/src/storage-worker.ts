import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { parentPort, Worker, workerData } from "node:worker_threads";
import { backupStorage, prepareStorage, StorageUpgradeError } from "./storage";

type Work = "prepare" | "backup";
type Ownership = { dev: bigint; ino: bigint; birthtimeNs: bigint };
type Input = { home: string; ownership: Ownership; active: SharedArrayBuffer; work: Work };
const identify = async (home: string): Promise<Ownership> => {
  const { dev, ino, birthtimeNs } = await lstat(join(home, ".tui.lock"), { bigint: true });
  return { dev, ino, birthtimeNs };
};

async function assertOwnership(home: string, ownership: Ownership, flag: Int32Array) {
  const current = await identify(home).catch(() => undefined);
  if (
    !Atomics.load(flag, 0) ||
    current?.ino !== ownership.ino ||
    current.dev !== ownership.dev ||
    current.birthtimeNs !== ownership.birthtimeNs
  )
    throw new StorageUpgradeError(
      "Exclusive storage ownership was lost. Close the other Loadstone instance before retrying.",
    );
}

/** Offload SQLite scans and migrations so they do not block the host event loop. */
export async function storageWorker(home: string, entry: string | URL) {
  const ownership = await identify(home);
  const active = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const data = new Int32Array(active);
  Atomics.store(data, 0, 1);
  const run = (work: Work) =>
    new Promise<string | undefined>((resolve, reject) => {
      const worker = new Worker(entry, {
        workerData: { home, ownership, active, work } satisfies Input,
      });
      worker.once("message", (result: string | undefined | { error: string }) => {
        if (result && typeof result === "object") reject(new StorageUpgradeError(result.error));
        else resolve(result);
      });
      worker.once("error", reject);
      worker.once("exit", () => reject(new Error("The storage worker exited without a result.")));
    });
  return {
    invalidate: () => Atomics.store(data, 0, 0),
    assertOwned: () => assertOwnership(home, ownership, data),
    prepare: () => run("prepare"),
    backup: async () => {
      const path = await run("backup");
      if (!path) throw new Error("No backup was created.");
      return path;
    },
  };
}

export async function handleStorageWork() {
  const port = parentPort;
  if (!port) throw new Error("Storage maintenance requires a worker thread.");
  const { home, ownership, active, work }: Input = workerData;
  const flag = new Int32Array(active);
  const assertOwned = () => assertOwnership(home, ownership, flag);
  try {
    const result = await (work === "prepare"
      ? prepareStorage(home, assertOwned)
      : backupStorage(home, assertOwned));
    port.postMessage(result);
  } catch (error) {
    port.postMessage({
      error:
        error instanceof StorageUpgradeError
          ? error.message
          : "Local storage maintenance failed. Check the data folder and its permissions.",
    });
  }
}
