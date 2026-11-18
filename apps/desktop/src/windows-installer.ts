import { execFile } from "node:child_process";
import { win32 } from "node:path";

export function windowsPowerShell(systemRoot = process.env.SystemRoot) {
  return systemRoot && win32.isAbsolute(systemRoot)
    ? win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : undefined;
}

export function windowsShellEnv(shell: string, overrides: Record<string, string>) {
  // A pwsh caller can export PowerShell 7 module paths that break Windows PowerShell.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "psmodulepath"),
  );
  return { ...env, ...overrides, PSModulePath: win32.join(win32.dirname(shell), "Modules") };
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
        Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public sealed class LoadstonePathGuard : IDisposable {
    const uint Read = 0x80000000, ShareRead = 1, OpenExisting = 3;
    const uint OpenReparsePoint = 0x00200000, BackupSemantics = 0x02000000;
    const uint DirectoryAttribute = 0x10, ReparseAttribute = 0x400;
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr sec, uint mode, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    static extern uint GetFileAttributesW(string path);
    readonly List<SafeFileHandle> handles = new List<SafeFileHandle>();
    public FileStream Stream { get; private set; }

    SafeFileHandle Pin(string path, bool directory) {
        // Open the entry itself, not its reparse target. Deny writes and deletion.
        var handle = CreateFileW(path, Read, ShareRead, IntPtr.Zero, OpenExisting,
            OpenReparsePoint | (directory ? BackupSemantics : 0), IntPtr.Zero);
        if (handle.IsInvalid) { handle.Dispose(); throw new IOException("Cannot pin installer path"); }
        handles.Add(handle);
        uint attrs = GetFileAttributesW(path);
        if (attrs == UInt32.MaxValue || (attrs & ReparseAttribute) != 0 || ((attrs & DirectoryAttribute) != 0) != directory)
            throw new IOException("Unexpected installer path type");
        return handle;
    }

    public LoadstonePathGuard(string path) {
        string full = Path.GetFullPath(path);
        string root = Path.GetPathRoot(full);
        if (root.Length != 3 || root[1] != ':' || !String.Equals(path, full, StringComparison.OrdinalIgnoreCase))
            throw new IOException("Expected a canonical local installer path");
        try {
            var parents = new Stack<string>();
            for (var dir = Directory.GetParent(full); dir != null; dir = dir.Parent) parents.Push(dir.FullName);
            foreach (string parent in parents) Pin(parent, true);
            Stream = new FileStream(Pin(full, false), FileAccess.Read);
        } catch { Dispose(); throw; }
    }

    public void Dispose() {
        if (Stream != null) Stream.Dispose();
        for (int i = handles.Count - 1; i >= 0; --i) handles[i].Dispose();
    }
}
'@
        $guard = [LoadstonePathGuard]::new($file)
        $sha = [System.Security.Cryptography.SHA512]::Create()
        try { $actual = [Convert]::ToBase64String($sha.ComputeHash($guard.Stream)) } finally { $sha.Dispose() }
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
        env: windowsShellEnv(shell, {
          LOADSTONE_VERIFY_FILE: path,
          LOADSTONE_VERIFY_PUBLISHER: publisher,
          LOADSTONE_VERIFY_SHA512: guardOptions?.sha512 ?? "",
          LOADSTONE_VERIFY_LAUNCH: guardOptions?.launch ? "1" : "0",
        }),
      },
      (error, _stdout, stderr) =>
        resolve(
          error || stderr.trim() ? "Windows installer signature could not be verified." : null,
        ),
    );
  });
}
