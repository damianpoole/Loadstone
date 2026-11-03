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
if (process.env.LOADSTONE_DISABLE_GPU === "1") app.disableHardwareAcceleration();
const ozone = process.env.LOADSTONE_OZONE_PLATFORM;
if (process.platform === "linux" && (ozone === "x11" || ozone === "wayland"))
  app.commandLine.appendSwitch("ozone-platform", ozone);
let startupStage = "Electron initialization";
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
      console.error(
        "[Loadstone] Storage did not close cleanly. Reopen the app to recover durable work.",
      );
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
  startupStage = "storage directory setup";
  await mkdir(home, { recursive: true, mode: 0o700 });
  // Same ownership protocol as the TUI. Never open SQLite before acquiring it.
  startupStage = "storage lock acquisition";
  release = await lockfile.lock(home, {
    lockfilePath: join(home, ".tui.lock"),
    stale: 30_000,
    retries: 0,
    onCompromised: () => {
      console.error("[Loadstone] Exclusive storage lock was lost; closing to protect data.");
      dialog.showErrorBox(
        "Loadstone storage lock",
        "Exclusive access to character storage was lost. Loadstone will close to protect your data.",
      );
      app.quit();
    },
  });
  startupStage = "character memory setup";
  controller = new Controller(home);
  const service = new DesktopService(controller);
  controller.state = {
    ...controller.state,
    notice:
      "Select or create a character to begin. Your last conversation resumes automatically. Memory is local; chat context is sent to your selected AI provider. Never paste credentials into chat.",
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
  startupStage = "desktop window creation";
  const window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    title: "Loadstone",
    // Do not depend on ready-to-show (or credential/session restoration) to
    // expose the window. Some Linux GPU/compositor failures never emit it.
    show: true,
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
  window.webContents.on("render-process-gone", (_event, details) => {
    if (closing) return;
    console.error(`[Loadstone] Renderer stopped: ${details.reason} (exit ${details.exitCode}).`);
    dialog.showErrorBox(
      "Loadstone renderer stopped",
      "The desktop renderer stopped unexpectedly. Try LOADSTONE_DISABLE_GPU=1 when launching from a terminal, and check the terminal diagnostics.",
    );
    app.quit();
  });
  // Restore in parallel with loading the visible UI. Controller.processing blocks
  // mutations until restoration completes, and its updates reach the renderer.
  const initialization = controller.initialize().catch((error) => {
    console.error(
      "[Loadstone] Session restoration failed; see the notice in the app. Memory has not been deleted.",
    );
    controller?.report(error);
  });
  startupStage = "renderer loading";
  await window.loadURL(renderer);
  console.log("[Loadstone] Desktop window loaded.");
  await initialization;
}

void main().catch((error: unknown) => {
  console.error(`[Loadstone] Startup failed during ${startupStage}:`, error);
  process.exitCode = 1;
  const locked = (error as NodeJS.ErrnoException).code === "ELOCKED";
  dialog.showErrorBox(
    "Loadstone could not start",
    locked
      ? "This character directory is already open in Loadstone desktop or the TUI. Close the other app first."
      : "Loadstone could not open its local storage or application resources. Check permissions and the LOADSTONE_HOME setting. Your data has not been deleted.",
  );
  app.quit();
});
