import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { expect, it } from "vite-plus/test";
import { verifyWindowsInstaller, windowsPowerShell, windowsShellEnv } from "./windows-installer";

it("requires an absolute Windows directory for the system trust tool", () => {
  expect(windowsPowerShell("relative")).toBeUndefined();
  expect(windowsPowerShell("C:\\Windows")).toBe(
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
});

it.skipIf(process.platform !== "win32")(
  "uses real Authenticode with the file held read-only, rejecting mismatches",
  async () => {
    const fixture = windowsPowerShell();
    if (!fixture) throw new Error("Expected Windows PowerShell on the Windows runner.");
    // Check an existing Windows-signed executable; do not run it as an installer.
    const publisher = execFileSync(
      fixture,
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$s = Get-AuthenticodeSignature -LiteralPath $env:LOADSTONE_SIGNATURE_FIXTURE; if ($s.Status -ne 'Valid') { exit 1 }; $s.SignerCertificate.Subject",
      ],
      {
        env: windowsShellEnv(fixture, { LOADSTONE_SIGNATURE_FIXTURE: fixture }),
        encoding: "utf8",
        timeout: 15_000,
      },
    ).trim();
    expect(publisher).toBeTruthy();
    const sha512 = createHash("sha512")
      .update(await readFile(fixture))
      .digest("base64");
    expect(await verifyWindowsInstaller(fixture, publisher, { sha512, launch: false })).toBeNull();
    expect(
      await verifyWindowsInstaller(fixture, "CN=Incorrect", { sha512, launch: false }),
    ).not.toBeNull();
    expect(
      await verifyWindowsInstaller(fixture, publisher, { sha512: "invalid", launch: false }),
    ).not.toBeNull();
    const temporary = await mkdtemp(join(tmpdir(), "Loadstone junction "));
    try {
      const junction = join(temporary, "redirected directory");
      await symlink(dirname(fixture), junction, "junction");
      expect(
        await verifyWindowsInstaller(join(junction, basename(fixture)), publisher, {
          sha512,
          launch: false,
        }),
      ).not.toBeNull();
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
  70_000,
);
