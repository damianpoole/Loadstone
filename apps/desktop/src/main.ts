import { app, BrowserWindow, dialog, ipcMain, session, type IpcMainInvokeEvent } from "electron";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import lockfile from "proper-lockfile";
import { Controller, DesktopService } from "@loadstone/application";
import { channels } from "./protocol";
import { contentSecurityPolicy, trustedFrame } from "./security";

process.umask(0o077);
let controller: Controller | undefined;
let release: (() => Promise<void>) | undefined;
let unsubscribe: (() => void) | undefined;
let closing = false;
let closed = false;

app.on("before-quit", (event) => {
  if (closed) return;
  event.preventDefault();
  if (closing) return;
  closing = true;
  void (async () => {
    try {
      unsubscribe?.();
      await controller?.close();
    } catch {
      dialog.showErrorBox(
        "Loadstone shutdown",
        "Storage could not close cleanly. Reopen Loadstone to recover durable work.",
      );
    } finally {
      await release?.().catch(() => {});
      closed = true;
      app.quit();
    }
  })();
});
app.on("window-all-closed", () => app.quit());

async function main() {
  await app.whenReady();
  const home = resolve(process.env.LOADSTONE_HOME ?? join(homedir(), ".loadstone"));
  await mkdir(home, { recursive: true, mode: 0o700 });
  // Same ownership protocol as the TUI. Never open SQLite before acquiring it.
  release = await lockfile.lock(home, {
    lockfilePath: join(home, ".tui.lock"),
    stale: 30_000,
    retries: 0,
    onCompromised: () => {
      dialog.showErrorBox(
        "Loadstone storage lock",
        "Exclusive access to character storage was lost. Loadstone will close to protect your data.",
      );
      app.quit();
    },
  });
  controller = new Controller(home);
  const service = new DesktopService(controller);
  await controller.initialize().catch((error) => controller?.report(error));
  if (!controller.state.character)
    controller.state = {
      ...controller.state,
      notice:
        "Select or create a character to begin. Memory is local; chat context is sent to your selected AI provider. Never paste credentials into chat.",
    };

  const renderer = pathToFileURL(join(__dirname, "renderer", "index.html")).href;
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [contentSecurityPolicy],
      },
    });
  });
  const window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    title: "Loadstone",
    show: false,
    backgroundColor: "#121820",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });
  const authorize = (event: IpcMainInvokeEvent) => {
    if (
      closing ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      !trustedFrame(event.senderFrame?.url, renderer)
    )
      throw new Error("Untrusted desktop request.");
  };
  ipcMain.handle(channels.snapshot, (event) => {
    authorize(event);
    return service.snapshot();
  });
  ipcMain.handle(channels.request, async (event, request: unknown) => {
    authorize(event);
    await service.request(request);
  });
  unsubscribe = service.subscribe((snapshot) => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed())
      window.webContents.send(channels.changed, snapshot);
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.once("ready-to-show", () => window.show());
  await window.loadURL(renderer);
}

void main().catch((error: unknown) => {
  const locked = (error as NodeJS.ErrnoException).code === "ELOCKED";
  dialog.showErrorBox(
    "Loadstone could not start",
    locked
      ? "This character directory is already open in Loadstone desktop or the TUI. Close the other app first."
      : "Loadstone could not open its local storage or application resources. Check permissions and the LOADSTONE_HOME setting. Your data has not been deleted.",
  );
  app.quit();
});
