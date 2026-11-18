import { execFile } from "node:child_process";
import { win32 } from "node:path";

export function windowsPowerShell(systemRoot = process.env.SystemRoot) {
  return systemRoot && win32.isAbsolute(systemRoot)
    ? win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : undefined;
}

/** Use a fixed script and fail closed. Guarded launch authenticates the file actually mapped by CreateProcess. */
export function verifyWindowsInstaller(
  path: string,
  publisher: string,
  guardOptions?: { sha512: string; launch: boolean },
): Promise<string | null> {
  const command = Buffer.from(
    `
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    $file = $env:LOADSTONE_VERIFY_FILE
    $digest = $env:LOADSTONE_VERIFY_SHA512
    $guard = $null
    try {
      if ($digest) {
        # FileShare.Read denies writes and deletion until process creation has finished.
        $guard = [System.IO.File]::Open($file, 'Open', 'Read', 'Read')
        $sha = [System.Security.Cryptography.SHA512]::Create()
        try { $actual = [Convert]::ToBase64String($sha.ComputeHash($guard)) } finally { $sha.Dispose() }
        if ($actual -cne $digest) { throw 'Installer digest mismatch' }
      }
      $s = Get-AuthenticodeSignature -LiteralPath $file
      if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -cne $env:LOADSTONE_VERIFY_PUBLISHER) { throw 'Untrusted installer' }
      if ($digest -and $env:LOADSTONE_VERIFY_LAUNCH -eq '1') {
        $start = New-Object System.Diagnostics.ProcessStartInfo
        $start.FileName = $file
        $start.Arguments = '--updated --force-run'
        $start.UseShellExecute = $false
        $start.WorkingDirectory = [System.IO.Path]::GetDirectoryName($file)
        $child = [System.Diagnostics.Process]::Start($start)
        if (-not $child) { throw 'Installer did not start' }
        $child.Dispose()
      }
    } finally { if ($guard) { $guard.Dispose() } }
  `,
    "utf16le",
  ).toString("base64");
  const shell = windowsPowerShell();
  if (!shell) return Promise.resolve("Windows trust verification unavailable.");
  return new Promise((resolve) => {
    execFile(
      shell,
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", command],
      {
        timeout: 30_000,
        windowsHide: true,
        env: {
          ...process.env,
          LOADSTONE_VERIFY_FILE: path,
          LOADSTONE_VERIFY_PUBLISHER: publisher,
          LOADSTONE_VERIFY_SHA512: guardOptions?.sha512 ?? "",
          LOADSTONE_VERIFY_LAUNCH: guardOptions?.launch ? "1" : "0",
        },
      },
      (error, _stdout, stderr) =>
        resolve(
          error || stderr.trim() ? "Windows installer signature could not be verified." : null,
        ),
    );
  });
}
