import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  safeStorage,
  shell,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import lockfile from "proper-lockfile";
import {
  Controller,
  DesktopService,
  DesktopAuth,
  storageWorker,
  StorageUpgradeError,
} from "@loadstone/application";
import { setupReleaseMenu } from "./release-menu";
import { closeForExit, PendingRequests } from "./updates";
import { channels } from "./protocol";
import { contentSecurityPolicy, trustedFrame } from "./security";

process.umask(0o077);
if (process.env.LOADSTONE_DISABLE_GPU === "1") app.disableHardwareAcceleration();
const ozone = process.env.LOADSTONE_OZONE_PLATFORM;
if (process.platform === "linux" && (ozone === "x11" || ozone === "wayland"))
  app.commandLine.appendSwitch("ozone-platform", ozone);
let startupStage = "Electron initialization";
let controller: Controller | undefined;
let authentication: DesktopAuth | undefined;
let release: (() => Promise<void>) | undefined;
let unsubscribe: (() => void) | undefined;
let closing = false;
let closed = false;
let installAfterClose = false;
let install: (() => Promise<void>) | undefined;
let storage: Awaited<ReturnType<typeof storageWorker>> | undefined;
let lockCompromised = false;
const requests = new PendingRequests();

app.on("before-quit", (event) => {
  if (closed) return;
  event.preventDefault();
  if (closing) return;
  closing = true;
  authentication?.cancel();
  controller?.abortSync();
  void (async () => {
    await startup;
    unsubscribe?.();
    const clean = await closeForExit(
      [() => authentication?.close(), () => requests.drain(), () => controller?.close()],
      () => (lockCompromised ? undefined : release?.()),
    );
    if (!clean || lockCompromised) {
      console.error("[Loadstone] Local storage did not shut down cleanly.");
      // An asynchronous dialog keeps the lease heartbeat running after a failed close.
      await dialog
        .showMessageBox({
          type: "error",
          title: "Loadstone shutdown",
          message: lockCompromised
            ? "Exclusive access to character storage was lost. Loadstone will close without installing an update."
            : "Local storage did not shut down cleanly. No update was installed. Reopen Loadstone to recover durable work.",
        })
        .catch(() => {});
    }
    closed = true;
    if (clean && !lockCompromised && installAfterClose && install) await install();
    else app.quit();
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
      lockCompromised = true;
      storage?.invalidate();
      console.error("[Loadstone] Exclusive storage lock was lost; closing to protect data.");
      app.quit();
    },
  });
  startupStage = "storage compatibility check";
  const maintenance = await storageWorker(home, join(__dirname, "storage-worker.cjs"));
  storage = maintenance;
  if (lockCompromised) maintenance.invalidate();
  const backup = await maintenance.prepare();
  if (closing) return;
  startupStage = "character memory setup";
  const encryptionAvailable = () =>
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text");
  authentication = new DesktopAuth(
    home,
    {
      encrypt: (value) => {
        if (!encryptionAvailable())
          throw new Error(
            "OS credential encryption is unavailable. Unlock your keychain or choose shared pi login.",
          );
        return safeStorage.encryptString(value);
      },
      decrypt: (value) => {
        if (!encryptionAvailable()) throw new Error("OS credential encryption is unavailable.");
        return safeStorage.decryptString(value);
      },
    },
    (url) => shell.openExternal(url),
  );
  await authentication.initialize();
  await maintenance.assertOwned();
  if (closing) return;
  const auth = authentication;
  controller = new Controller(home, undefined, () => auth.connection(), true, maintenance);
  const service = new DesktopService(controller, auth, async (url) => {
    const { response } = await dialog.showMessageBox({
      type: "question",
      title: "Open RuneScape Wiki in your browser?",
      message: "This leaves Loadstone and contacts the RuneScape Wiki in your system browser.",
      detail: url,
      buttons: ["Cancel", "Open wiki"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (response === 1) await shell.openExternal(url);
  });
  controller.state = {
    ...controller.state,
    notice: backup
      ? `Local storage upgraded. Pre-upgrade backup: ${backup}`
      : "Select or create a character to begin. Your last conversation resumes automatically. Memory is local; chat context is sent to your selected AI provider. Never paste credentials into chat.",
  };

  const renderer = pathToFileURL(join(__dirname, "renderer", "index.html")).href;
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
  const allowClipboardWrite = (
    contents: WebContents | null,
    permission: string,
    details: { isMainFrame: boolean; requestingUrl?: string },
  ) =>
    !closing &&
    !window.isDestroyed() &&
    contents === window.webContents &&
    permission === "clipboard-sanitized-write" &&
    details.isMainFrame &&
    trustedFrame(details.requestingUrl, renderer);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(allowClipboardWrite(contents, permission, details)),
  );
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
    allowClipboardWrite(contents, permission, details),
  );
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
  ipcMain.handle(channels.memory, (event) => {
    authorize(event);
    return service.memory();
  });
  ipcMain.handle(channels.request, async (event, request: unknown) => {
    authorize(event);
    await requests.track(service.request(request));
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
    void dialog
      .showMessageBox(window, {
        type: "warning",
        title: "Loadstone display stopped",
        message:
          "The display stopped unexpectedly. Reload it to reconnect to your saved conversation. An unsent draft may be lost; stored memory and backend work are not reset.",
        buttons: ["Reload display", "Close Loadstone"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (closing || window.isDestroyed()) return;
        if (response === 0) window.webContents.reload();
        else app.quit();
      })
      .catch(() => app.quit());
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
  if (!closing) {
    install = await setupReleaseMenu(
      () => !closing,
      () => {
        installAfterClose = true;
        app.quit();
      },
    );
  }
  await initialization;
}

const startup = main().catch((error: unknown) => {
  console.error(`[Loadstone] Startup failed during ${startupStage}.`);
  process.exitCode = 1;
  const locked = error instanceof Error && "code" in error && error.code === "ELOCKED";
  dialog.showErrorBox(
    "Loadstone could not start",
    error instanceof StorageUpgradeError
      ? error.message
      : locked
        ? "This character directory is already open in Loadstone desktop or the TUI. Close the other app first."
        : "Loadstone could not open its local storage or application resources. Check permissions and the LOADSTONE_HOME setting. Your data has not been deleted.",
  );
  app.quit();
});
