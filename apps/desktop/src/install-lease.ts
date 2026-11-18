import { createHash } from "node:crypto";
import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { acquireProcessLease } from "@loadstone/application";

const exists = async (path: string) => {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
};

/** Not based on LOADSTONE_HOME or Electron's user-data override. */
export async function acquireInstallationLease(directory: string, executable: string) {
  const canonical = await realpath(executable);
  const identity = createHash("sha256")
    .update(process.platform === "win32" ? canonical.toLowerCase() : canonical)
    .digest("hex");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const unlock = acquireProcessLease(join(directory, `${identity}.sqlite`));
  const barrier = join(directory, `${identity}.pending`);
  try {
    if (await exists(barrier)) throw new Error("This installation is being updated.");
  } catch (error) {
    unlock();
    throw error;
  }
  return {
    // Keep the SQLite lease until Electron exits; the barrier covers the handoff.
    unlock,
    async beginUpdate() {
      await writeFile(barrier, "Loadstone update in progress\n", { flag: "wx", mode: 0o600 });
      return { barrier, executable: canonical };
    },
  };
}
