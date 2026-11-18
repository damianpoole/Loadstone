export type UpdateState = "idle" | "checking" | "downloading" | "current" | "ready" | "failed";

type UpdateTransport = {
  checkForUpdates(): Promise<{ isUpdateAvailable: boolean } | null>;
  downloadUpdate(): Promise<unknown>;
};

/** Checking is opt-in; only an explicit, separately confirmed action installs. */
export class UpdateDownload {
  private running?: Promise<void>;
  state: UpdateState = "idle";
  constructor(
    private readonly transport: UpdateTransport,
    private readonly onChange: (state: UpdateState) => void,
  ) {}

  check(): Promise<void> {
    if (this.running) return this.running;
    if (this.state === "ready") return Promise.resolve();
    this.running = this.run().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  invalidate() {
    this.set("failed");
  }

  private set(state: UpdateState) {
    this.state = state;
    this.onChange(state);
  }

  private async run() {
    try {
      this.set("checking");
      const update = await this.transport.checkForUpdates();
      if (!update) throw new Error("Updater unavailable.");
      if (!update.isUpdateAvailable) {
        this.set("current");
        return;
      }
      this.set("downloading");
      await this.transport.downloadUpdate();
      this.set("ready");
    } catch {
      this.set("failed");
    }
  }
}

export class PendingRequests {
  private readonly pending = new Set<Promise<void>>();
  track(request: Promise<void>) {
    this.pending.add(request);
    return request.finally(() => this.pending.delete(request));
  }
  async drain() {
    await Promise.allSettled(this.pending);
  }
}

/** Always attempt each close, but keep the lock until exit if any store failed. */
export async function closeForExit(
  steps: (() => Promise<unknown> | undefined)[],
  release: () => Promise<void> | undefined,
) {
  let clean = true;
  for (const step of steps) {
    try {
      await step();
    } catch {
      clean = false;
    }
  }
  if (!clean) return false;
  try {
    await release();
    return true;
  } catch {
    return false;
  }
}
