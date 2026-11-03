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

**Not included:** graphical provider login, a Loadstone-owned credential store,
review/undo controls, a session browser, production signing/notarization, automatic
updates, migration backups, branding/icons, or public downloads. Native Wayland,
AppImage runtime behavior and distribution coverage beyond the Linux CI runner
still need manual validation.
The preview is not yet suitable for general RS3 players. Some backend notices still
refer to TUI slash commands; those are not desktop instructions.

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

The preview retains the existing connection behavior: it can reuse pi's auth store
and defaults, or use provider environment credentials. It does **not** require an
installed pi executable when credentials are already available or an environment
key is used. It does not yet offer a graphical login flow.

For example, set `LOADSTONE_AUTH=env`, `OPENAI_API_KEY`, and optionally
`LOADSTONE_PROVIDER` / `LOADSTONE_MODEL` in the launching shell. Anthropic and
OpenRouter environment keys are also supported; select the corresponding model.
Do not paste a key into chat. Environment variables inherited from a shell may not
be present when launching from Finder/Explorer. This is an intentional preview
limitation, not the planned player onboarding experience.

Connection settings can display credential **metadata only** and set a provider /
model ID. Invalid authentication does not submit a chat, and the desktop preserves
the draft on submission errors. Memory and RuneMetrics sync work without AI auth.
See [the existing authentication guide](ironman-tui.md) for current variables.

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
- Window opening, navigation, webviews and permission requests are denied.
- Model Markdown is rendered as React elements; raw HTML and images are disabled.
  Links currently display their URL but are not clickable. Future external links
  must use a backend HTTP(S)-only allowlist, never arbitrary `shell.openExternal`.
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

This slice does not change the database schema or create migration backups. The
memory store rejects a newer schema. Before distributing schema/runtime upgrades,
implement the backup/compatibility policy in slice 4 below. Do not assume an older
application can reopen a database migrated by a newer pi-durable version.

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

- [ ] Inspect the **pinned** pi SDK's public interactive login/logout APIs and
      supported provider flows; only upgrade deliberately with refresh regression tests.
- [ ] Introduce a private Loadstone-owned credential store. Existing shared pi login
      becomes an explicit choice with disclosure that refresh writes to that store.
- [ ] Use SDK locking/refresh, not copied OAuth tokens or hand-written OAuth flows.
- [ ] Build first-run choice: supported browser login, API key, existing pi login,
      or continue without AI. Use the system browser; support callback/device/paste
      fallback where appropriate, cancellation, timeout, logout and revoked credentials.
- [ ] Decide OS credential encryption/keychain integration without breaking SDK
      refresh. POSIX modes/umask are not a complete Windows secret-storage strategy.
- [ ] Add model discovery/selection with account compatibility and cost guidance.
- [ ] Replace TUI-specific notices with structured operation/error results and
      finish extracting typed application methods. Never surface raw provider secrets.
- [ ] Confirm provider terms before advertising subscription compatibility.

**Acceptance:** a new Windows user with no Node/pi can connect a supported provider,
create an Ironman, sync, chat, restart, and reconnect after an expired/revoked login.
No shell, environment variables, or manual JSON editing are required.

### Slice 3 — complete player-facing interaction and data controls

- [ ] Memory review/approve/reject/undo/history with provenance, clearly explaining
      automatic saves. Until then use the TUI while desktop is closed to review saves.
- [ ] Session list/resume, character modes (desktop creation currently defaults to
      Ironman), goals/plans, readable tool receipts rather than slash-command guidance.
- [ ] Backup/export/restore flows and explicit data-folder selection/migration.
- [ ] Better incremental Markdown, copy controls, safe external links, stable
      scroll anchoring when loading older messages and large-history virtualization.
- [ ] Accessible keyboard flow, screen-reader testing, text scaling, high DPI,
      reduced motion and readable contrast; tests for forms, drafts and errors.
- [ ] Renderer-crash recovery and responsive shutdown/cancel behavior under slow
      network/storage; profile main-process SQLite work before choosing a utility process.
- [ ] Measure idle CPU/memory and responsiveness while RS3 is running.

**Acceptance:** a player can discover and correct saved information entirely in the
GUI and understand what is local, what was synced, and what goes to an AI provider.

### Slice 4 — safe releases and upgrades

- [ ] Decide release identity/domain, OS minimums/architectures and preview/stable
      channels. Add icons, product metadata and project/license policy.
- [ ] Generate third-party license notices for **bundled** dependencies/assets;
      do not assume a bundled application automatically includes those notices.
- [ ] Windows code signing; macOS signing, hardened-runtime entitlements and
      notarization. Establish protected signing secrets and trusted release workflows.
- [ ] Integrate a maintained Electron updater matched to builder's installer formats;
      define authenticated release metadata, artifact verification and hosting.
- [ ] Download updates without interrupting chat; install only after storage closes.
      Prevent concurrent TUI access during first-open migration as well as normal use.
- [ ] Before any schema migration, create consistent, restorable backups of BOTH
      memory and durable-session databases; do not copy live WAL files naively.
- [ ] Maintain explicit schema/runtime compatibility, test interrupted upgrades,
      disk-full/failed downloads, and refuse unsupported downgrades. App rollback is
      not database rollback; restoration can discard newer progress and needs consent.
- [ ] Installer/uninstaller tests with spaces, non-admin users and existing data;
      never delete character data by default. Validate on machines with no dev tools.
- [ ] Electron dependency/security update policy, disabled-by-default or explicitly
      disclosed diagnostics, redacted logs, and a dependency/security review.
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
