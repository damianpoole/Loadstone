import { app, dialog, Menu, type MenuItemConstructorOptions } from "electron";
import { autoUpdater, NsisUpdater } from "electron-updater";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { UpdateDownload, type UpdateState } from "./updates";
import { matchesStableFeed, stableFeed, validSHA512, verifyStagedInstaller } from "./update-trust";
import { verifyWindowsInstaller } from "./windows-installer";

const labels: Record<UpdateState, string> = {
  idle: "Check for updates (GitHub)…",
  checking: "Checking for updates…",
  downloading: "Downloading update in background…",
  current: "Up to date — check again",
  ready: "Install downloaded update and restart…",
  failed: "Update failed — check again",
};

async function enabled() {
  const windows = process.platform === "win32" && process.arch === "x64";
  const mac = process.platform === "darwin" && process.arch === "arm64";
  if (!app.isPackaged || (!windows && !mac)) return false;
  try {
    const policy: unknown = JSON.parse(
      await readFile(join(process.resourcesPath, "loadstone-stable.json"), "utf8"),
    );
    if (
      !policy ||
      typeof policy !== "object" ||
      !("version" in policy) ||
      policy.version !== app.getVersion()
    )
      return false;
    const config = await readFile(join(process.resourcesPath, "app-update.yml"), "utf8");
    if (windows) {
      if (
        !(autoUpdater instanceof NsisUpdater) ||
        !("publisher" in policy) ||
        typeof policy.publisher !== "string" ||
        !policy.publisher.startsWith("CN=")
      )
        return false;
      const publisher = policy.publisher;
      if (!matchesStableFeed(config, publisher)) return false;
      autoUpdater.verifyUpdateCodeSignature = (_publishers, installer) =>
        verifyWindowsInstaller(installer, publisher);
      return { publisher };
    }
    return matchesStableFeed(config) ? { publisher: undefined } : false;
  } catch {
    return false;
  }
}

export async function setupReleaseMenu(canInteract: () => boolean, requestInstall: () => void) {
  const policy = await enabled();
  if (!policy) return;
  // Do not log raw URLs, response bodies, paths, or certificate information.
  autoUpdater.logger = null;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.setFeedURL(stableFeed);
  let expectedHash: string | undefined;
  let installer: string | undefined;
  const verify = async () => {
    const publisher = policy.publisher;
    if (!publisher) return;
    if (!installer || !expectedHash) throw new Error("Verified installer unavailable.");
    await verifyStagedInstaller(installer, expectedHash, (path) =>
      verifyWindowsInstaller(path, publisher),
    );
  };
  const discardInstaller = async () => {
    if (installer) await rm(installer, { force: true }).catch(() => {});
    installer = undefined;
  };
  let installTimer: ReturnType<typeof setTimeout> | undefined;
  const installFailed = () => {
    if (!installTimer) return;
    clearTimeout(installTimer);
    installTimer = undefined;
    dialog.showErrorBox(
      "Loadstone update not installed",
      "Your data was closed safely. Reopen Loadstone to retry, or install the signed release manually.",
    );
    app.quit();
  };
  autoUpdater.on("error", installFailed);

  let confirming = false;
  const click = async () => {
    if (!canInteract() || confirming) return;
    if (download.state !== "ready") {
      await download.check();
      return;
    }
    confirming = true;
    try {
      const { response } = await dialog.showMessageBox({
        type: "question",
        title: "Restart to update Loadstone?",
        message:
          "Loadstone will close your saved data before installing. Unsent drafts will be lost.",
        buttons: ["Later", "Install and restart"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (response !== 1 || !canInteract()) return;
      try {
        await verify();
      } catch {
        await discardInstaller();
        download.invalidate();
        return;
      }
      if (canInteract()) requestInstall();
    } finally {
      confirming = false;
    }
  };
  const menu = (state: UpdateState) => {
    const release: MenuItemConstructorOptions = {
      label: "Updates",
      submenu: [
        {
          label: labels[state],
          enabled: state !== "checking" && state !== "downloading",
          click: () => {
            void click().catch(() =>
              dialog.showErrorBox(
                "Loadstone update",
                "Could not check for or install the update. You can keep using Loadstone.",
              ),
            );
          },
        },
      ],
    };
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === "darwin"
          ? [{ role: "appMenu" } as const]
          : [{ role: "fileMenu" } as const]),
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
        release,
      ]),
    );
  };
  const download = new UpdateDownload(
    {
      async checkForUpdates() {
        const result = await autoUpdater.checkForUpdates();
        if (policy.publisher && result?.isUpdateAvailable) {
          const [file] = result.updateInfo.files;
          if (
            result.updateInfo.files.length !== 1 ||
            !file?.url.endsWith(".exe") ||
            !validSHA512(file.sha512)
          )
            throw new Error("Unexpected Windows update metadata.");
          expectedHash = file.sha512;
        }
        return result;
      },
      async downloadUpdate() {
        const files = await autoUpdater.downloadUpdate();
        if (!policy.publisher) return;
        installer = files[0];
        try {
          if (files.length !== 1) throw new Error("Expected a single Windows installer.");
          await verify(); // Also covers the builder's cached-download path.
        } catch (error) {
          await discardInstaller();
          throw error;
        }
      },
    },
    menu,
  );
  menu(download.state);
  return async () => {
    // Squirrel.Mac can still fail native signature verification at this point.
    // Do not leave a storage-closed app hanging if native installation stalls.
    installTimer = setTimeout(installFailed, 90_000);
    try {
      if (policy.publisher) {
        if (
          !installer ||
          !expectedHash ||
          (await verifyWindowsInstaller(installer, policy.publisher, {
            sha512: expectedHash,
            launch: true,
          }))
        )
          throw new Error("Could not launch the verified Windows update.");
        clearTimeout(installTimer);
        installTimer = undefined;
        app.quit();
      } else {
        autoUpdater.quitAndInstall(false, true);
      }
    } catch {
      await discardInstaller();
      installFailed();
    }
  };
}
