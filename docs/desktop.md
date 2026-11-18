# Loadstone desktop: architecture, first slice, and delivery plan

## Status and scope

This is an **internal Electron preview**, not the public player release. Electron
is the selected desktop framework; the TUI and CLI remain supported. Players will
ultimately install a desktop app without Node, pnpm, Git, or pi. Developers still
need the repository's pinned Node/pnpm toolchain.

The first slice establishes the runtime and packaging boundary:

- React character selection/creation, RuneMetrics sync, saved-memory inspection,
  chat, streaming/tool status, cancellation, basic model settings and new chats.
- Existing character, active session and durable conversation restored on restart.
- A shared application controller used by both desktop and TUI.
- A sandboxed renderer, narrow validated IPC and no provider credentials in React.
- Self-contained application code and dependencies inside Electron's ASAR.
- Unsigned Windows NSIS, macOS DMG/ZIP and Linux DEB/AppImage packaging and CI artifacts.
- Deterministic durable-chat integration tests and real Electron/package smoke tests.

Slice 2 adds graphical provider connection, an encrypted Loadstone-owned credential
store, explicit shared-pi opt-in, offline onboarding and account-scoped model selection.
The pinned pi SDK remains at 1.4.0; no SDK upgrade or hand-written OAuth is involved.

Slice 3's player-control increment adds memory correction/review/history/undo with
provenance, searchable session resume, character modes, goals/planning, character
exports and all-character/chat backups. Chat adds copy controls, confirmed HTTPS
RuneScape Wiki links, earlier-message scroll anchoring and text scaling. The display
can reload after a renderer crash without restarting the backend.

**Not included:** in-app backup restore/data-folder migration, large-history
virtualization, production signing/notarization, automatic updates, migration
backups, branding/icons, or public downloads. Native Wayland,
AppImage runtime behavior and distribution coverage beyond the Linux CI runner
still need manual validation.
The preview is not yet suitable for general RS3 players. Memory tool receipts and
player controls now use desktop instructions, but full typed-method/notice extraction
is still unfinished; model-generated advice may still mention slash commands.

## Run from source

From the repository root, using the Node/pnpm versions in `mise.toml`:

```bash
pnpm install --frozen-lockfile
pnpm run desktop
```

This builds **and launches** Electron. The launcher prints an explicit startup
message, strips an inherited `ELECTRON_RUN_AS_NODE` flag, forwards Electron's stderr,
and reports abnormal exits with Linux-specific guidance. It deliberately uses
production local files, not a dev web server or hot reload. Rebuild/relaunch after
edits. To launch an already-built app without rebuilding:

```bash
pnpm --filter loadstone-desktop run launch
```

The window is visible before session/auth restoration completes; startup does not
rely on the compositor emitting `ready-to-show`. Startup errors are also written
to the terminal, not just a possibly hidden native dialog.

To avoid touching existing TUI data during development:

```bash
LOADSTONE_HOME="$HOME/.loadstone-desktop-preview" pnpm run desktop
```

PowerShell:

```powershell
$env:LOADSTONE_HOME = "$HOME\.loadstone-desktop-preview"
pnpm run desktop
```

### Authentication in this slice

First launch defaults to **Continue without AI**. Create/open an Ironman and sync
RuneMetrics without credentials, or choose a credential store in **Connect AI**:

- **Private Loadstone credentials (recommended):** SDK login writes to
  `credentials.enc` under the character data directory. Electron `safeStorage`
  encrypts the entire store with the OS account's credential protection. Windows
  uses DPAPI; macOS uses Keychain; Linux requires a supported secret service.
  Linux's `basic_text` fallback is rejected, not treated as encryption. There is
  no plaintext fallback. Unlock OS credential storage if saving fails.
- **Shared pi login:** explicit consent to read and potentially refresh/write pi's
  original `auth.json`. Tokens are not copied. SDK file-store locking and refresh
  remain authoritative. Disconnect here removes that provider from pi too.
- **Continue without AI:** prevents chat and durable recovery from sending model
  requests, including through inherited environment keys. It does not erase saved
  credentials; reconnect by choosing their store again.

Choose a provider, then **Connect API key** or **Browser login** where the pinned
SDK supports it. API keys, select prompts, device codes and manual callback/code
fallback use dedicated login controls, never chat. Only SDK-issued HTTPS URLs
open in the system browser; the renderer cannot request arbitrary external URLs.
Cancel login at any time; flows time out after five minutes. Restart restores the
selected store, not an unfinished login. Failed/revoked authentication preserves
the chat draft; reconnect through these same controls.

The initial supported provider surface is OpenAI, Anthropic, OpenRouter and GitHub
Copilot, restricted to methods actually exposed by the pinned SDK. Models are
listed only for providers with credentials in the selected store. This is a
catalog/account-auth filter, **not a guarantee of account entitlement**; the
provider may reject an individual model. Displayed input/output prices are SDK
catalog estimates per million tokens, not a billing quote. No subscription
compatibility is advertised or guaranteed; confirm provider terms independently.

The SDK's public `CredentialStore.modify` callback serializes private login,
logout and refresh writes, with atomic encrypted-file replacement. The desktop's
exclusive data-directory lock protects it across processes. React receives only
credential metadata and active login prompts; secret answers travel through a
validated IPC request, are not echoed to snapshots, and are cleared from the form.
Provider failure bodies are replaced with reconnect guidance on desktop. The TUI
keeps its existing environment/shared-pi behavior (see [its guide](ironman-tui.md)).

**Validation still required:** real provider browser/callback/device flows,
expired/revoked-token recovery, and OS encryption/installation on a clean Windows
account. Automated tests cover SDK API-key login, interaction adaptation,
cancellation, encrypted persistence/refresh serialization, offline transport
blocking, IPC validation and Electron shared-store restart/chat. This is not yet
a claim that Slice 2's clean-Windows acceptance gate has passed.

## Architecture

```text
apps/desktop/src/renderer     React + safe Markdown rendering
             |
             | contextBridge: snapshot / request / subscribe
             v
apps/desktop/src/preload.ts   Sandboxed, single-file CommonJS bridge
             |
             | allow-listed IPC; exact top-level sender/document validation
             v
apps/desktop/src/main.ts      Electron lifecycle, storage lock, permissions
             |
packages/application         Shared Controller + typed DesktopService adapter
             |
             +-- packages/agent       pi-durable, scoped tools, auth refresh
             +-- packages/memory      SQLite facts/history/characters/sessions
             +-- packages/wiki-client RuneMetrics and wiki requests
```

### Why this shape

- Start with the agent in Electron's main process. No Node sidecar or extra runtime
  is needed. Measure responsiveness before moving it into a utility process.
- The renderer never opens databases, reads tokens, executes tools, or receives an
  arbitrary command/path/shell API. All network requests belong to the backend.
- The TUI controller was moved intact into `packages/application`, with the old
  TUI import path retained as a compatibility re-export. Existing controller tests
  moved with it. This reduces migration risk rather than rebuilding orchestration.
- `DesktopService` is the typed facade. For now it maps validated actions onto the
  shared command interpreter. The renderer cannot send arbitrary slash commands.
  A later refactor should extract typed controller methods and leave parsing in a
  TUI adapter. Terminal formatting/help text is transitional, not the end-state API.
- Main and preload are built separately because sandboxed preloads cannot require
  shared local chunks. The backend's lazy SDK/provider chunks are all packaged.
  Runtime packages are build-time dependencies because Vite Plus bundles them;
  no pnpm workspace symlinks are required in the installed app.
- electron-builder was chosen instead of adding Forge's application build pipeline:
  Vite Plus already builds the code, and builder supplies ASAR/NSIS/DMG packaging.
  Updater integration is deliberately not configured yet.

Electron is pinned to **45.2.1**. The local packaged smoke test reports its bundled
Node as **24.22.1**, which satisfies our current Node requirement and successfully
opens both Node SQLite memory and pi-durable storage. Re-run those tests whenever
Electron or pi dependencies change; do not infer compatibility from Electron's
package-install `engines` field.

### Security boundary

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
- IPC validates the sender WebContents, top-level frame, exact bundled file URL,
  operation type, input sizes and fields. Arbitrary slash commands are rejected.
- CSP forbids renderer connections, inline/eval scripts, frames, forms and objects.
- Window opening, navigation and webviews are denied. Only the app's main frame
  can write plain text to the clipboard; clipboard reads and other permissions
  are denied.
- Model Markdown is rendered as React elements; raw HTML and images are disabled.
  Only HTTPS `runescape.wiki` links can open externally, after a native confirmation
  showing the URL. The backend rejects other hosts, embedded credentials and custom
  ports; no arbitrary URL/path/shell API is exposed. Other links remain text.
- Credentials stay in the SDK/backend. The status response contains metadata,
  never keys/tokens. Provider keys must never be written to renderer storage.
- No coding-agent tools, project extensions or user scripts are deliberately loaded
  by the application. The SDK is used for models/auth, not a coding-agent session.

### Storage ownership and compatibility

For this slice the default remains `~/.loadstone`, overridden by `LOADSTONE_HOME`.
This gives existing users their characters and conversations without an automatic
copy/migration. Desktop and TUI both take the **same `.tui.lock` directory lock**
before opening SQLite. A second instance must refuse to open that home. Separate
homes can be used for independent previews. Do not delete a live lock manually.

Closing the desktop waits for controller shutdown and durable storage closure,
then releases ownership. Closing may wait for an in-flight auth/network operation;
force-quitting instead leaves recovery to SQLite/pi-durable and the stale-lock
heartbeat policy. Main-process crashes are not guaranteed graceful shutdowns.

Desktop and TUI check memory (`PRAGMA user_version`) and every saved conversation
(pi-durable's `durable_schema`) under the shared lock, before opening writable
storage. Both current schemas are version 2, with the pinned pi-durable 1.4.0 runtime.
Unsupported newer or unrecognized formats stop startup, including in inactive chats.
Before an existing database is migrated, Loadstone makes and verifies a complete
SQLite backup of memory and sessions, including committed WAL pages. The process
writes a `backup.json` manifest and publishes `backups/pre-migration-*` only after
all copies complete. No migrations start if the snapshot fails. Credentials are not
copied or changed by migration. New homes and already-compatible data do not need
pre-migration snapshots.

Each database migration is atomic, but the collection is not one transaction. If an
upgrade is interrupted, keep the earliest complete pre-migration snapshot; retrying
can finish the remaining migrations or create another snapshot of the intermediate
state. Ignore any `.partial-*` backup directory. A storage maintenance worker keeps
the lock heartbeat responsive during scans/migrations. It checks lock ownership
before publishing snapshots and before each migration. See [offline recovery](ironman-tui.md#storage-backup-and-privacy) before
attempting a rollback. The schema number alone does not prove runtime compatibility;
review the pin, record encoding and auth SDK behavior on every runtime upgrade.

## Packaging and validation

```bash
pnpm run check-types
pnpm run test
pnpm run lint
pnpm run format:check
pnpm run build
pnpm run desktop:smoke
pnpm run desktop:package  # unpacked app under apps/desktop/release/
pnpm run desktop:make     # host-platform installers; never publishes
```

To test the unpacked app on macOS/Windows:

```bash
LOADSTONE_SMOKE_PACKAGED=1 pnpm run desktop:smoke
```

Or set `LOADSTONE_SMOKE_EXECUTABLE` to an absolute installed executable path.
PowerShell uses `$env:LOADSTONE_SMOKE_PACKAGED = "1"` before the command.
The smoke script uses an isolated temporary home (including spaces in its path),
a fake stored API key, no provider requests and no existing user credentials.
It checks renderer isolation, SDK model loading, a streamed chat response and its
replay after restart, seeded character memory, rejected slash-command IPC, lock
exclusion and graceful lock release. The test intercepts Node's fetch through the
test debugger with deterministic Responses API events; it does not add a test-mode
backdoor to the app. It runs with a working directory outside the checkout. A separate
application integration test uses a real pi-durable harness and deterministic faux
provider to verify chat delivery and persisted conversation replay after reopening.
No test-only provider or credential bypass is exposed by the production app.

`.github/workflows/desktop.yml` builds and tests Windows, macOS and Ubuntu 24.04,
smoke-tests the packaged application, and installs/smoke-tests Windows NSIS and
Linux DEB in CI. The Linux job uses Xvfb/X11 with Chromium's sandbox **enabled**;
it configures only the trusted CI build's sandbox helper, not system-wide user
namespace restrictions. The smoke script asserts the window is actually visible.
CI runs the full repository formatting check, not a scoped exception.

It uploads short-lived **unsigned internal preview** installers, not public
releases. Linux AppImage execution, native Wayland, GPU/driver differences and
other distributions still need manual testing. Artifacts also need a clean
user-machine check with development tools absent; CI contains build tools.

Local validation on the development Mac covers the actual packaged ARM64 app.
Windows installer results must be established by the Windows CI job; a macOS build
alone is not evidence of Windows compatibility. Live provider login/chat and
RuneMetrics availability require separate manual acceptance testing.

## Linux launch troubleshooting

Run from a graphical session and capture both the build and launch output:

```bash
pnpm run desktop 2>&1 | tee /tmp/loadstone-desktop.log
```

After the build you should see `[Loadstone] Build complete. Starting the desktop
app…` followed by `[Loadstone] Desktop window loaded.`. If not, the terminal
should show the failed phase, native error or abnormal exit. Logs may contain
local filesystem paths; review them before sharing. Never share auth.json or keys.

### Display and GPU/compositor problems

- A headless SSH session/container without `DISPLAY` or `WAYLAND_DISPLAY` cannot
  open a desktop window. The source launcher now fails clearly in this case.
- For a black/missing window or GPU crash, try software rendering:

  ```bash
  LOADSTONE_DISABLE_GPU=1 pnpm run desktop
  ```

- On a Wayland session with XWayland available, compare X11 behavior:

  ```bash
  LOADSTONE_OZONE_PLATFORM=x11 pnpm run desktop
  ```

  `LOADSTONE_OZONE_PLATFORM=wayland` requests native Wayland explicitly. These are
  opt-in diagnostics, not forced defaults. They do not disable the sandbox.

- `error while loading shared libraries` identifies a missing system dependency.
  Install the package supplying the named library for your distribution (common
  Electron dependencies include GTK 3, NSS, GBM and ALSA). Linux DEB installation
  resolves declared system dependencies through the package manager.

### Chromium sandbox / Ubuntu user namespace restrictions

If stderr mentions `No usable sandbox`, `SUID sandbox helper`, `namespace`, or
`zygote_host_impl_linux`, the failure is before the React app starts. Ubuntu 24.04+
can restrict unprivileged user namespaces through AppArmor. Do not run the app as
root, globally weaken AppArmor, or use `--no-sandbox` as a permanent workaround.

Prefer installing the trusted DEB preview on Debian/Ubuntu: electron-builder's
installer configures its sandbox helper and, where supported, an application
AppArmor profile. This is different from running an unpacked development download.

For a **trusted local Electron dependency only**, a system administrator can set
up its setuid helper if required by the distribution:

```bash
cd apps/desktop
helper="$(node -p 'require("node:path").join(require("node:path").dirname(require("electron")), "chrome-sandbox")')"
sudo chown root:root "$helper"
sudo chmod 4755 "$helper"
cd ../..
pnpm run desktop
```

This is an explicit privileged change to one downloaded executable, not something
the launcher performs automatically. Verify/trust the Electron dependency first;
a reinstall can replace the helper and require reconfiguration. Follow your
distribution's security guidance if a setuid helper is not permitted. AppImage
mounts can have different sandbox constraints and are not assumed equivalent to
an installed DEB.

If the app still does not open, share the launch output, distribution/version,
X11/Wayland session type, and whether either graphics diagnostic changes it.

## Next slices, in order

### Slice 2 — graphical authentication and onboarding

- [x] Inspect the **pinned** pi SDK's public interactive login/logout APIs and
      supported provider flows; only upgrade deliberately with refresh regression tests.
- [x] Introduce a private Loadstone-owned credential store. Existing shared pi login
      becomes an explicit choice with disclosure that refresh writes to that store.
- [x] Use SDK locking/refresh, not copied OAuth tokens or hand-written OAuth flows.
- [ ] Build first-run choice: supported browser login, API key, existing pi login,
      or continue without AI. Use the system browser; support callback/device/paste
      fallback where appropriate, cancellation, timeout, logout and revoked credentials.
- [x] Decide OS credential encryption/keychain integration without breaking SDK
      refresh. POSIX modes/umask are not a complete Windows secret-storage strategy.
- [x] Add model discovery/selection with account compatibility and cost guidance.
- [ ] Replace TUI-specific notices with structured operation/error results and
      finish extracting typed application methods. Never surface raw provider secrets.
- [ ] Confirm provider terms before advertising subscription compatibility.

**Acceptance:** a new Windows user with no Node/pi can connect a supported provider,
create an Ironman, sync, chat, restart, and reconnect after an expired/revoked login.
No shell, environment variables, or manual JSON editing are required.

### Slice 3 — complete player-facing interaction and data controls

- [x] Memory correction/review/approve/reject/undo/history with before/after values
      and provenance, clearly explaining automatic saves and whole-operation approval.
- [x] Searchable session list/resume, Ironman/Hardcore/Group Ironman creation,
      goals/plans, and desktop-specific memory tool receipts.
- [x] Character JSON export and consistent all-character/conversation backup controls
      using the existing backend; no renderer-controlled filesystem paths.
- [ ] In-app restore and explicit data-folder selection/migration. These need a
      separately tested offline replacement/compatibility design; no destructive
      live-database replacement is exposed by this increment.
- [x] Message copy, confirmed allowlisted wiki links, and earlier-message scroll
      anchoring. Existing history remains paged by the agent.
- [ ] Incremental Markdown and large-history virtualization/performance validation.
- [x] Text scaling, keyboard-visible focus, skip-to-composer link, polite status
      announcements, reduced-motion styling, and Electron form/review/session tests.
- [ ] Screen-reader, full keyboard, high-DPI/contrast manual acceptance and broader
      draft/error/scroll regression coverage. Scaling is per-window, not persisted.
- [x] Renderer-crash reload/close choice retains backend ownership and saved data;
      a normal renderer reload is covered by smoke. Unsent drafts are not durable.
- [ ] Forced-crash and slow network/storage shutdown/cancel acceptance; profile
      main-process SQLite work before choosing a utility process.
- [ ] Measure idle CPU/memory and responsiveness while RS3 is running.

This increment is **not completion of the entire Slice 3 acceptance gate**. History
shows the latest 100 operations plus every pending review; character export includes
full history. Goals, history and reviews reload separately when saved memory changes,
not during ordinary chat streaming. All decisions are character-scoped and serialized
with agent/sync work. Unsent drafts stay with their conversation until the window
is reloaded or closed.
Stale approval and undo of facts touched by newer updates fail without changing memory.
The correction form accepts kind-validated JSON values (including quoted text), not
commands; regressions and deletions become proposals instead of silently overwriting
progress. New-character mode selection never changes an existing character's mode.

Use **Export and backup** in the sidebar. Export contains facts and memory audit
history, not conversation text. Backup contains all character memory and session
SQLite files: the backend closes the durable companion, uses SQLite's backup API for
memory, uses SQLite's backup API for closed session databases too, then reopens the companion even if snapshotting fails.
Output paths appear in Status under the current data home's `exports/` or `backups/`.
Neither includes credentials. A character JSON export is **not** a restorable chat
backup. Until graphical restore ships, follow the [offline recovery procedure](ironman-tui.md#storage-backup-and-privacy)
while **both desktop and TUI are closed**, keep the originals, and restore only with
a compatible application version. Never copy a backup over open databases.

Automated coverage includes kind/size/URL IPC rejection, provenance-preserving edits,
review/reject/undo and stale/cross-character guards, exported history, backup contents
and reopening, and chat after backup. Electron smoke exercises correction, regression
rejection, undo, session search/resume, text scaling, export/backup and display reload.
No live provider, forced-crash, screen-reader, RS3 performance or Windows manual
acceptance is claimed by these tests.

**Acceptance:** a player can discover and correct saved information entirely in the
GUI and understand what is local, what was synced, and what goes to an AI provider.

### Slice 4 — safe releases and upgrades

See [the desktop release runbook](desktop-release.md) for channel policy, signing
setup, release verification and the public distribution gate.

- [x] Define release identity, target architectures/OSes and preview/stable channels;
      add product icon/metadata and document the project's current license policy.
- [x] Generate and ship notices for bundled JavaScript and the Electron runtime.
- [x] Add protected signed-candidate workflow, hardened runtime and notarization
      configuration. Distribution is still blocked pending credential provisioning.
- [x] Stable-only updater: user-initiated checks, background download, payload and
      platform signature verification, explicit confirmation and shutdown gate.
- [x] Shared preflight with migration backups of both SQLite stores; incompatible
      schemas fail closed. Cover interrupted migration, failed staging and disk-full
      backup via tests. App rollback is not data rollback.
- [ ] Provision signing environments, review distribution rights/notices and record
      signed end-to-end update, non-admin install/uninstall and recovery acceptance
      on clean Windows/macOS machines without developer tools.
- [ ] Validate Linux separately before advertising support.

**Acceptance:** signed installation and an upgrade preserve character progress,
conversation history and credentials; interrupted upgrades leave a usable app or
an explicit tested recovery path. Reopening in the TUI follows compatibility rules.

### Slice 5 — website and public launch

- [ ] Static download site with platform detection and explicit alternative downloads.
- [ ] Setup guide, screenshots, provider/cost requirements, troubleshooting,
      backups/restoration, privacy, local-data deletion and release notes.
- [ ] Explain that local persistence is not local model execution: chat/retrieved
      context goes to the selected provider, sync to RuneMetrics, wiki requests to wiki.
- [ ] Appropriate RuneScape/non-affiliation notices and dependency attribution.
- [ ] Small external-player test group before broad distribution; issue/reporting
      flow with no credential or private-memory collection by default.

**Acceptance:** a nontechnical RS3 player can install and use the companion from
website instructions alone, without help from a repository maintainer.
