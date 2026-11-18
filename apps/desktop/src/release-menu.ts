import { app, dialog, Menu, type MenuItemConstructorOptions } from "electron";
import { autoUpdater, NsisUpdater } from "electron-updater";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { win32, join } from "node:path";
import { UpdateDownload, type UpdateState } from "./updates";

const labels: Record<UpdateState, string> = {
  idle: "Check for updates (GitHub)…",
  checking: "Checking for updates…",
  downloading: "Downloading update in background…",
  current: "Up to date — check again",
  ready: "Install downloaded update and restart…",
  failed: "Update failed — check again",
};

// Use a fixed script (no shell and no interpolation) and fail closed if Windows
// cannot verify trust or the signed publisher is not the shipped identity.
function verifyWindowsInstaller(path: string, publisher: string): Promise<string | null> {
  const command = Buffer.from(
    "$ErrorActionPreference = 'Stop'; " +
      "$s = Get-AuthenticodeSignature -LiteralPath $env:LOADSTONE_VERIFY_FILE; " +
      "if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -cne $env:LOADSTONE_VERIFY_PUBLISHER) { exit 1 }",
    "utf16le",
  ).toString("base64");
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !win32.isAbsolute(systemRoot))
    return Promise.resolve("Windows trust verification unavailable.");
  return new Promise((resolve) => {
    execFile(
      win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", command],
      {
        timeout: 30_000,
        windowsHide: true,
        env: { ...process.env, LOADSTONE_VERIFY_FILE: path, LOADSTONE_VERIFY_PUBLISHER: publisher },
      },
      (error, _stdout, stderr) =>
        resolve(
          error || stderr.trim() ? "Windows installer signature could not be verified." : null,
        ),
    );
  });
}

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
    await readFile(join(process.resourcesPath, "app-update.yml"), "utf8");
    if (windows) {
      if (
        !(autoUpdater instanceof NsisUpdater) ||
        !("publisher" in policy) ||
        typeof policy.publisher !== "string" ||
        !policy.publisher.startsWith("CN=")
      )
        return false;
      const publisher = policy.publisher;
      autoUpdater.verifyUpdateCodeSignature = (_publishers, installer) =>
        verifyWindowsInstaller(installer, publisher);
    }
    return true;
  } catch {
    return false;
  }
}

export async function setupReleaseMenu(canInteract: () => boolean, requestInstall: () => void) {
  if (!(await enabled())) return;
  // Do not log raw URLs, response bodies, paths, or certificate information.
  autoUpdater.logger = null;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableDifferentialDownload = true;
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

  const click = async () => {
    if (!canInteract()) return;
    if (download.state !== "ready") {
      await download.check();
      return;
    }
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
    if (response === 1 && canInteract()) requestInstall();
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
  const download = new UpdateDownload(autoUpdater, menu);
  menu(download.state);
  return () => {
    // Squirrel.Mac can still fail native signature verification at this point.
    // Do not leave a storage-closed app hanging if native installation stalls.
    installTimer = setTimeout(installFailed, 90_000);
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch {
      installFailed();
    }
  };
}
