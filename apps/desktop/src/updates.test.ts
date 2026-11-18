import { describe, expect, it, vi } from "vite-plus/test";
import { closeForExit, UpdateDownload, type UpdateState } from "./updates";

function fixture() {
  const transport = {
    checkForUpdates: vi.fn<() => Promise<{ isUpdateAvailable: boolean } | null>>(),
    downloadUpdate: vi.fn<() => Promise<unknown>>(),
  };
  const states: UpdateState[] = [];
  return {
    transport,
    states,
    update: new UpdateDownload(transport, (state) => states.push(state)),
  };
}

describe("desktop update staging", () => {
  it("does nothing until asked and coalesces clicks without waiting on app work", async () => {
    const { transport, states, update } = fixture();
    expect(transport.checkForUpdates).not.toHaveBeenCalled();
    transport.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true });
    const download = Promise.withResolvers<void>();
    transport.downloadUpdate.mockReturnValue(download.promise);
    const pending = update.check();
    expect(update.check()).toBe(pending);
    await Promise.resolve();
    expect(states).toEqual(["checking", "downloading"]);
    download.resolve();
    await pending;
    expect(update.state).toBe("ready");
    await update.check();
    expect(transport.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("leaves the current app usable after a corrupt or disk-full download and allows retry", async () => {
    const { transport, update } = fixture();
    transport.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true });
    transport.downloadUpdate.mockRejectedValueOnce(new Error("ENOSPC")).mockResolvedValueOnce([]);
    await update.check();
    expect(update.state).toBe("failed");
    await update.check();
    expect(update.state).toBe("ready");
  });

  it("does not stage unavailable versions and does not treat a feed error as up to date", async () => {
    const { transport, update } = fixture();
    transport.checkForUpdates
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ isUpdateAvailable: false });
    await update.check();
    expect(update.state).toBe("failed");
    await update.check();
    expect(update.state).toBe("current");
    expect(transport.downloadUpdate).not.toHaveBeenCalled();
  });
});

describe("shutdown gate", () => {
  it("does not authorize install or release the home while storage is closing", async () => {
    const closed = Promise.withResolvers<void>();
    const release = vi.fn();
    const install = vi.fn();
    const done = closeForExit([() => closed.promise, release]).then((clean) => {
      if (clean) install();
    });
    expect(release).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
    closed.resolve();
    await done;
    expect(release).toHaveBeenCalledBefore(install);
  });

  it("vetoes install on a failed close, but still closes remaining stores and releases ownership", async () => {
    const storage = vi.fn();
    const release = vi.fn();
    const clean = await closeForExit([
      () => Promise.reject(new Error("could not close credentials")),
      storage,
      release,
    ]);
    expect(clean).toBe(false);
    expect(storage).toHaveBeenCalledBefore(release);
    expect(await closeForExit([() => Promise.reject(new Error("lost ownership"))])).toBe(false);
  });
});
