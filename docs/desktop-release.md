# Desktop release runbook

## Identity and channels

Loadstone (`dev.loadstone.desktop`) is an independent RuneScape 3 companion, not
endorsed by Jagex. The canonical source and download origin is
[`damianpoole/Loadstone` on GitHub](https://github.com/damianpoole/Loadstone); the bundle
ID is not a claim to a web domain. Keep the bundle ID, platform signing identity,
installer scope and storage path stable across upgrades. The original compass
artwork is in `apps/desktop/packaging/icon.svg`.

| Channel               | Candidate targets                                                           | Distribution                                                   |
| --------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Internal preview      | macOS, Windows x64 NSIS, Ubuntu 24.04 x64 DEB/AppImage                      | Unsigned short-lived CI artifacts, **no update feed**          |
| Stable (not open yet) | macOS 14+ Apple silicon (DMG + updater ZIP), Windows 11 x64 (per-user NSIS) | Signed assets on GitHub Releases; macOS additionally notarized |

Windows 11 and macOS 14 on actual clean systems are **acceptance targets**, not a
claim of certification. Linux stays internal until specifically validated; Intel
Mac, Windows ARM64 and other Linux distributions are not stable targets. Do not
point a preview at a stable feed or repurpose a stable release for testing.

Loadstone's own code/artwork remains `UNLICENSED`. Public source visibility does
not grant a license or permission to redistribute; get maintainer approval for
the first binary distribution and confirm distribution rights/terms. The
bundle generates third-party notices from JS modules retained by both production
bundlers, including split provider chunks. They ship under `third-party-notices/`
in packaged resources; Electron's own and Chromium's notices ship beside the
binary (in Resources on macOS). An unrecognized package without license text
blocks the build. See [notice sources](../apps/desktop/licenses/README.md) for
version-pinned fallbacks. Review these, non-JS runtime/installer components, asset
rights and any obligations not captured by license texts before publishing.

## Protected candidate build

1. In GitHub, create `desktop-release-macos` and `desktop-release-windows` as
   protected environments. Restrict deployments to `main`, require an independent
   reviewer and prevent self-approval. Protect `main` and release tags; restrict
   Releases, environment editing and secrets to designated maintainers. Do not
   put signing credentials in repository-wide secrets, PR checks or local previews.
2. macOS environment secrets: `MAC_CSC_LINK` (base64 Developer ID Application
   PKCS#12), `MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY_B64` (base64 App Store Connect
   `.p8`). Variables: `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`. Use a scoped Apple
   key that can notarize and keep the signing identity/Team ID stable. Builder
   signs the hardened app and notarizes/staples it; the workflow independently
   notarizes/staples the DMG and checks Gatekeeper.
3. Windows environment secret: `AZURE_CLIENT_SECRET`. Variables: `AZURE_CLIENT_ID`,
   `AZURE_TENANT_ID`, `SIGN_ENDPOINT`, `SIGN_ACCOUNT`, `SIGN_PROFILE`,
   `WINDOWS_PUBLISHER`. Give the service principal only the signer role for the
   intended public-trust Azure Trusted Signing profile. `WINDOWS_PUBLISHER` must
   be the exact full `Get-AuthenticodeSignature` certificate `Subject` (starting
   `CN=`), not a friendly label. The workflow checks the chain, subject and timestamp
   of both the installer and executable. Do not waive checks if provider setup fails.
4. Review a release version bump to `apps/desktop/package.json` (plain, strictly
   increasing `major.minor.patch`). Review frozen dependencies plus `pnpm audit`,
   Electron/Chromium/Node and SDK security advisories, and license differences.
   Track Electron stable at each release and review advisories at least monthly;
   prioritize actively exploited or critical fixes and rerun signed acceptance for
   Electron, builder, updater, SDK or installer changes. An audit is not coverage of
   Electron binaries, Windows trust, Apple notarization, or unpublished advisories.
5. Dispatch **Desktop signed candidates** on reviewed `main`, with the exact package
   version. Use both outputs from the **same commit/run** and verify their signatures
   and metadata before promotion. The workflow has read-only permissions and
   `--publish never`; its artifacts are candidates, not release assets. A successful
   workflow is not a substitute for the acceptance below.

## Updater and promotion

Stable builds include **Updates → Check for updates (GitHub)** in the native menu.
It contacts GitHub only on request. A new installer/ZIP downloads in the background
without blocking chat. Installation requires a separate confirmation and only starts
if credentials and storage close cleanly and the home lock is released. Normal quit
never installs. There is no update IPC in the renderer. If fetching or staging fails,
the current app stays usable; retry from the menu. If native installation fails after
shutdown, reopen the existing app or reinstall the signed release manually.

The updater uses the fixed public GitHub release origin over TLS, with stable
`latest.yml` (Windows) or `latest-mac.yml` (macOS). Electron-updater verifies payload
SHA-512; the metadata is not separately signed. Trust in GitHub's release origin,
release permissions and tag protections is therefore part of the security model.
Windows verifies Authenticode trust and the exact packaged publisher, failing closed
when Windows cannot verify. macOS Squirrel additionally verifies the app's signing
identity before replacement. Prereleases and downgrades are disabled. Rotate signing
credentials without changing identity, or plan a separately reviewed migration/manual
install if identity changes.

Validate via a **separate GitHub staging release repository and explicitly reviewed
staging builds** (the public GitHub provider needs readable artifacts; never embed
repository credentials, repoint production, or use production data in tests). Once
acceptance is recorded, create a GitHub draft for immutable `v<version>` targeting the
candidate commit. Upload the exact `.exe`, `.dmg`, `.zip`, `latest*.yml` and corresponding
blockmaps without renaming or rebuilding. Verify all assets before publishing as the
latest **stable**, not prerelease. Do not overwrite a published version or edit update
metadata. Enable GitHub release immutability before public rollout. Prefer a fixed
forward version over reverting the feed; rolling back binaries cannot undo migrated data.

## Release acceptance (must record before public distribution)

- On a clean non-admin **Windows 11 x64** machine with no Node/pi/build tooling:
  verify publisher, install under a path with spaces, open a home with data, upgrade,
  then uninstall and reinstall. Confirm character memory, chat and credentials remain.
- On clean **macOS 14+ arm64**: download through a browser so Gatekeeper sees quarantine,
  verify DMG/app notarization, install as an ordinary user and repeat upgrade/reinstall.
  Do not remove quarantine or weaken security policy to make the test pass.
- Exercise two signed versions via staging over HTTPS: check/download while streaming,
  defer and quit without installing, retry network loss or a failed download, reject
  mismatched payload and wrong signer, then install after local storage closes. Try a
  nearly full disk for both staging and first launch. Verify restart, active character,
  facts, chat replay, private OS-encrypted credentials and authenticated provider use.
- Verify TUI exclusion during first-open migration and open with a current TUI after
  desktop quit. Verify an older version refuses unsupported storage. On a disposable
  home simulate interruption at the migration boundary, retry, and restore the original
  full snapshot into a separate home with a compatible version.
- Inspect failure output and packaged notices; do not collect chat, credentials,
  memory files or raw provider errors as diagnostic artifacts. Loadstone does not
  enable crash reporting or upload application telemetry.

Automated coverage includes download-state failures and shutdown ordering, SQLite
snapshots from both committed WAL and closed databases, disk-full injection,
partial-migration retry and newer-schema rejection in inactive sessions. Desktop CI
exercises a legacy memory upgrade with a real persisted chat and checks notices in
packaged/installed builds. The signed workflow verifies candidate format/signatures
only after credentials are provisioned. Public distribution remains blocked until
actual signed install/update and clean-machine results are recorded.
