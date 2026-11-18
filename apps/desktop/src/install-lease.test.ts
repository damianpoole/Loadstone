import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { acquireInstallationLease } from "./install-lease";

it("blocks other app copies until the installation handoff finishes, independently of home", async () => {
  const temp = await mkdtemp(join(tmpdir(), "loadstone install gate "));
  try {
    const executable = join(temp, "Loadstone.exe");
    const gates = join(temp, "gates");
    await writeFile(executable, "fixture");
    const original = await acquireInstallationLease(gates, executable);
    let barrier: string;
    try {
      await expect(acquireInstallationLease(gates, executable)).rejects.toMatchObject({
        code: "ELOCKED",
      });
      barrier = (await original.beginUpdate()).barrier;
    } finally {
      original.unlock();
    }
    await expect(acquireInstallationLease(gates, executable)).rejects.toThrow("being updated");
    await rm(barrier);
    (await acquireInstallationLease(gates, executable)).unlock();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
