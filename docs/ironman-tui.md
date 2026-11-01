# Ironman companion TUI

Loadstone now has a chat-first **Ink** application in `apps/tui`, an agent powered by
**@earendil-works/pi-durable**, and a local SQLite character-memory repository.
The existing CLI and its JSON output remain independent.

## Start

Use the repository's pinned Node.js and pnpm versions:

```bash
mise trust && mise install
pnpm install --frozen-lockfile

# Already signed in to pi? Its existing login (including ChatGPT OAuth) is reused.
# Otherwise, run /login openai inside pi, or configure an environment API key.
pnpm run tui
```

The TUI requires an interactive terminal. `pnpm --filter loadstone-tui start --help`
prints setup and command help without requiring one. After building, run
`node apps/tui/dist/index.js` directly. Keep the installed workspace dependencies
and all files in `dist/`: this is an ESM application with chunks, not a standalone binary.

## Authentication

By default, Loadstone uses pi's public **ModelRuntime 1.4.0 SDK** and shared
`~/.pi/agent/auth.json`. Existing ChatGPT OAuth does not require a separate API
key. Token refresh uses the SDK's file locking and updates pi's original store;
Loadstone does not copy tokens into its own database, exports or backups.
Normal provider/subscription limits still apply.

- `PI_CODING_AGENT_DIR` changes pi's directory (including `settings.json`).
- `LOADSTONE_PI_AUTH_PATH` optionally selects another pi-format `auth.json`.
- `/auth` shows the path and credential types, never keys or tokens. It does not
  refresh tokens or make model requests. It is a startup snapshot, not a live
  authentication check. Restart after logging in/out in pi.
- New sessions use pi's valid `defaultProvider`/`defaultModel` from `settings.json`
  unless Loadstone environment variables or a saved `/model` choice override them.
  Without a pi preference, OpenAI OAuth defaults to `openai/gpt-5.5`.
- **Existing sessions keep their model.** Use `/model pi` to switch to pi's default
  (or the connection fallback if pi has no usable preference). This also updates
  Loadstone's default for future sessions.
- Stored pi credentials take precedence over environment keys. Set
  `LOADSTONE_AUTH=env` to bypass pi completely and use environment-only auth.
- No pi `models.json`, project settings, extensions, or coding tools are loaded.
  Only built-in catalog models are selectable. This does **not** import OpenCode
  credentials or provide a login UI: log in through pi itself.

If pi's default auth file is absent, Loadstone falls back to environment credentials.
An explicitly configured missing auth path is an error. If OAuth expires or refresh
fails, sign in again in pi and restart; don't paste credentials into chat.

Environment-only example:

```bash
export LOADSTONE_AUTH=env
export LOADSTONE_PROVIDER=openai
export LOADSTONE_MODEL=gpt-4o-mini
# Supply OPENAI_API_KEY through your shell/secret manager.
pnpm run tui
```

Environment-only providers (shared-pi mode also exposes pi's built-in catalog):

| Provider     | Environment variable | Example model                            |
| ------------ | -------------------- | ---------------------------------------- |
| `openai`     | `OPENAI_API_KEY`     | `gpt-4o-mini`                            |
| `anthropic`  | `ANTHROPIC_API_KEY`  | `claude-sonnet-4-5`                      |
| `openrouter` | `OPENROUTER_API_KEY` | Use `/models openrouter` for catalog IDs |

`/models FILTER` lists the pinned pi-ai catalog. `/model PROVIDER MODEL_ID` changes
the current conversation and the default for new sessions. `LOADSTONE_PROVIDER`
and `LOADSTONE_MODEL` override defaults for **new** sessions; existing sessions
retain their chosen model. Restart after changing credential configuration.

You can create characters, edit/browse memory, export/backup, and sync RuneMetrics
without model authentication. Only chat needs it. There are no background model calls for
new characters; reopening a session with unfinished work resumes that work.

## First conversation

```text
/character YourRSN
/sync
What should I work on before unlocking Prifddinas?
I just hit 90 Herblore.
I completed Smoking Kills and got my first abyssal whip.
I want to unlock Invention.
/memory
/history
```

By default `/character RSN` selects an existing character or creates an Ironman.
`/create hardcore RSN` and `/create group-ironman RSN` create other account modes.
Names are case-insensitive; sessions and tools are bound to one character.
Switching characters never transfers their facts or chat history.

The agent decides when to save clear progress, goals, and preferences. An exact
quote from the latest user message is required for chat-derived changes, and the
memory repository validates the values. Goals and hypothetical progress are not
achieved unlocks. This distinction is a model instruction, not a deterministic
natural-language classifier: review important facts and correct mistakes.

You see saved memory operations in the transcript, the character name and **Last
saved facts** in the sidebar, and pending conflicts in the header. The sidebar
lists up to three facts by local save time, with their source (RuneMetrics sync or
user report). It is **not a recent in-game activity feed**: `NOT STARTED` is a
stored quest status, not a new action. A bulk sync may save many statuses at once,
so equally recent entries do not indicate an order of in-game events. Use
`/memory` for all facts and observation times. `/history` includes full receipts and evidence.
The UI shows “saved” only after the SQLite transaction commits.

## Response formatting

Assistant responses render terminal Markdown, including streamed responses:
headings, **bold**, _italic_, strikethrough, inline/fenced code, lists/task lists,
quotes, links and tables. Code preserves indentation; tables use a compact
pipe-delimited layout that wraps to the available width. Links show their URL;
images show their description/URL rather than downloading anything. Raw HTML
is displayed literally, not interpreted. Headings and strong emphasis use bold,
not underline; underline is reserved for links. Terminals use a fixed character
size, so heading levels cannot have browser-style font sizes. Bold/italic appearance
depends on your terminal font and settings; this is a terminal layout, not an
HTML/CSS rendering engine.

Your messages are **cyan**, while assistant text uses the terminal's default
foreground with Markdown styling. User messages, tool output and notices stay
literal so commands and reported facts are not reinterpreted as Markdown.
Role labels remain visible even without colour. Set `NO_COLOR=1` to disable ANSI
styling while keeping the readable Markdown layout.

Formatting is display-only: persisted conversations and model context keep the
original Markdown. Terminal controls in message content are stripped before
trusted styles are added. Styled lines wrap and scroll independently without
colour leaking into the rest of the interface.

## Controls and commands

- **Slash-command autocomplete:** type `/` at the start of the prompt to open a
  command overlay. Keep typing to filter command names. **↑ / ↓** select an item
  (wrapping at either end); **Enter** fills the prompt with the command and a space
  without executing it. Add any arguments, then press Enter again to run it.
  **Esc** dismisses the menu without cancelling active work. Editing the command
  prefix reopens it; entering arguments or an unknown prefix hides it.
- **Enter:** send a message/command when the completion menu is closed. Paste text,
  then press Enter to send.
- **Esc:** cancel the active agent run or manual RuneMetrics sync. Cancelling does
  not undo already committed memory; use `/undo` if needed.
- **↑ / ↓ or mouse wheel/trackpad:** scroll the current view three lines at a time.
- **PageUp / PageDown:** scroll one page with a line of overlap (Mac: **Fn+↑ / Fn+↓**).
- **Home / End:** jump to the oldest loaded text / latest output (Mac: **Fn+← / Fn+→**).
- Scrolling back pauses automatic following: streamed text will not drag you away
  from what you are reading. Scroll to the bottom or press End to follow again.
  The status line shows your position. `/earlier` loads older persisted messages
  beyond the currently loaded conversation; Home then jumps to their beginning.
- The app uses an alternate screen, so terminal scrollback is not the conversation
  history. Mouse reporting is enabled while the TUI is open and disabled on exit.
  Hold **Shift** for native selection/scrolling in terminals that support it, or
  set **`LOADSTONE_MOUSE=0`** to disable mouse capture and use keyboard scrolling.
- **Tab:** switch between chat and the memory view.
- **Ctrl+C / `/quit`:** orderly shutdown, preserving unfinished agent work for resume.
- Wide terminals show a character/goals/recent-memory sidebar; narrow ones show chat only.

| Command                                                              | Purpose                                                                       |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `/help`                                                              | Show help                                                                     |
| `/character [RSN]`                                                   | List or select/create characters                                              |
| `/create MODE RSN`                                                   | Create an Ironman, hardcore, or group-ironman                                 |
| `/sync`                                                              | Fresh skills and quests from RuneMetrics                                      |
| `/memory [query]`                                                    | Search facts with provenance                                                  |
| `/goals [query]`                                                     | Browse goals and nested plan steps with current readiness                     |
| `/plan TARGET`                                                       | Research any RS3 outcome and save a prerequisite plan as ordered nested goals |
| `/history`                                                           | Last 30 operations, including previous values                                 |
| `/pending`                                                           | Inspect proposed changes and conflicts                                        |
| `/approve ID`, `/reject ID`                                          | Resolve a pending proposal explicitly                                         |
| `/undo ID`                                                           | Reverse a saved operation if its affected facts have not changed since        |
| `/set KIND KEY = JSON`                                               | Manually set/correct a fact                                                   |
| `/forget KIND KEY`                                                   | Propose deletion; requires `/approve ID`                                      |
| `/new`                                                               | New conversation, retaining character memory                                  |
| `/sessions`                                                          | List the active character's sessions                                          |
| `/resume SESSION_ID`                                                 | Open one of those sessions                                                    |
| `/earlier`                                                           | Load 50 older stored entries, including history before compaction             |
| `/retry`                                                             | Retry parked crash-loop tasks, or send an explicit continuation after failure |
| `/models [filter]`, `/model PROVIDER MODEL_ID`, `/model pi`, `/auth` | Model and authentication configuration                                        |
| `/export`                                                            | Export character facts and audit history to a private JSON file               |
| `/backup`                                                            | Consistent local backup of all character memory and sessions                  |

While the agent is working, read-only inspection is available, but new messages,
manual edits, sync, and character/session changes require cancellation first. No
hidden queue of messages can unexpectedly modify another character.

### Outcome planning

`/plan` accepts an outcome, not only a quest name. For example:

```text
/plan Prifddinas
/plan unlock Invention
/plan obtain an abyssal whip
/plan prepare for normal-mode Arch-Glacor
/goals
/goals Prifddinas
```

The agent researches RS3 Wiki pages, compares prerequisites with the active
character's saved facts, and saves a root goal plus nested, ordered subgoals in
one atomic operation. Each step includes wiki sources, practical notes, dependency
IDs, and structured requirements where available. Parents group subgoals; explicit
`dependsOn` links describe prerequisite order. The wide sidebar shows root goals
rather than filling up with their subgoals. `/goals` shows the full tree.

All generated goals begin **active**, not completed. Readiness is recalculated
from current memory whenever goals are read:

- **satisfied:** the recorded requirements and child goals are satisfied; this is
  a computed hint, not a newly saved quest/unlock or goal completion.
- **ready:** dependencies are satisfied and the step can be worked on.
- **blocked:** prerequisite steps are not yet satisfied.
- **needs confirmation:** relevant progress is unknown, including unknown item quantities.
- **subgoals:** work through the nested steps first.
- **paused / completed:** explicitly saved goal statuses.

The root's status remains under your control; it is not automatically completed.
A step with no structured requirements is a manual checklist item. `/goals`
prints each step's goal key; use it to change its status, for example:

```text
/set goal prifddinas / enter = "completed"
/set goal Prifddinas = "paused"
```

Replace `enter` with the actual ID printed for your plan. Pausing a root does not
rewrite its subgoals. Record actual in-game progress in chat, with `/set`, or
`/sync`; do not mark a goal complete as a substitute for recording a quest fact.

Plans are **model-generated advice**, not a deterministic, exhaustive quest
solver. Requirement selection and source fidelity depend on the model. The
repository validates the structure, ordering, acyclic dependencies (including
parent/child edges), skill names/levels, and wiki URL shapes, but does not prove
that a cited page contains a claim. Review sources and unknowns before a long
grind. Ambiguous requests may need a more specific `/plan` command; unavailable
research should not be represented as a verified plan. Plans are bounded to 60
steps; large outcomes may need scoped follow-up plans with unresolved work
explicitly noted.

The saved plan metadata is a `plan` fact containing JSON; goal statuses remain
ordinary `goal` facts, preserving existing commands. Generated metadata is labeled
as advice, and its evidence records the planning request rather than claiming
the user reported those prerequisites. Creation is visible in `/history`, included
in exports/backups, and replay-safe after interruption. `/undo OPERATION_ID`
reverses the entire creation, provided no affected facts changed afterward.
An existing target cannot be silently replaced: inspect `/goals`, undo later goal
edits and then the original creation if needed, or use a distinct target for an
alternative plan. Deleting only the metadata leaves its goals as standalone goals;
undo the creation to remove the complete plan together.

### Manual facts

```text
/set skill Herblore = 90
/set quest Smoking Kills = "COMPLETED"
/set item Abyssal whip = {"owned":true,"quantity":1}
/set unlock Prifddinas = true
/set goal Unlock Invention = "active"
/set preference Training = "Prefer AFK methods"
/set note Bossing = "Learning normal-mode Arch-Glacor"
/forget item Abyssal whip
/pending
```

Kinds:

- **skill:** known RS3 skill, integer level 1–120 (not virtual levels).
- **quest:** `NOT_STARTED`, `STARTED`, or `COMPLETED`.
- **item:** `{ "owned": boolean, "quantity"?: nonnegative integer }`. Omit unknown
  quantities; zero means not owned. Quantities are absolute, not increments.
- **unlock:** boolean, explicitly reported rather than inferred from wiki text.
- **goal:** `active`, `paused`, or `completed`, with the goal description as the key.
- **preference / note:** nonempty text.

Keys are whitespace-normalized and case-insensitive. Absence is **unknown**,
not false or incomplete. Each fact carries source, observation and recording times,
evidence, and the operation that last wrote it. Item ownership/quantities are
**last reported**, never claimed to be a live bank view.

## Sync and conflict policy

The existing CLI `getRSProfile()` remains backward compatible. A new
`getRSProfileSnapshot()` provides independent, validated availability results for
skills and quests, always bypassing the disk cache. Each request has a 20-second
network timeout and cancellation support.

- Private profiles, failed requests, malformed responses, and unavailable quests
  never erase existing facts. A successful empty list also does not imply deletion.
- Skills may sync when quests fail and vice versa.
- Observation time is request start, so a slow response cannot appear newer than
  a user update made during the request.
- Lower skill levels, backward quest progress, revoked unlocks, stale observations,
  and deletions require review. Conflicting API data cannot silently replace a
  user's report. Forward API progress is accepted.
- A related batch commits atomically; if it has a conflict, the whole batch waits
  for review. RuneMetrics skills and quests are separate batches, so a quest
  conflict does not prevent safe skill updates.
- Approval refuses a proposal if affected facts changed since it was made. Reject
  it and make a fresh update. Undo similarly refuses to overwrite newer changes.
  It restores each exact previous fact, including its original provenance, so you
  can undo successive updates in reverse order. Each undo has its own audit
  receipt with an `undoOf` link; original receipts remain intact for replay safety.

RuneMetrics does not expose a complete bank, relevant equipment, or unlock list.
Report those in chat or with `/set`. An API can itself lag behind the game even
when fetched freshly; the conflict policy protects saved progress from regressions.

## Storage, backup, and privacy

Default location (`LOADSTONE_HOME` overrides this):

```text
~/.loadstone/
  memory.sqlite          Characters, facts, history/receipts, sessions and defaults
  sessions/<UUID>.sqlite pi-durable conversations, tasks, memos and model choices
  exports/<UUID>.json    Explicit character exports
  backups/<UUID>/        Explicit all-character/session backups
  .tui.lock/             Exclusive ownership heartbeat (temporary)
  cache/                 Existing wiki cache, independently configurable
```

New files/directories are owner-only on POSIX. Existing directories are not
re-permissioned. Data is **not encrypted at rest**. Character summaries, retrieved
facts, wiki results and chat are sent to the selected model provider; RuneMetrics
receives the selected RSN. There is no cloud memory sync or background telemetry
export. Use disk encryption if needed.

Keys are resolved from environment variables and are not copied into settings or
exports by the app. **Anything you type into chat is stored in its transcript**;
do not paste credentials. Forget/undo changes active memory but preserves the
audit trail and old transcript context. It is not a secure erasure feature.

`/backup` closes the active harness, uses SQLite's online backup for memory, copies
the closed session databases (including any WAL sidecars), then reopens the session.
The exclusive home-directory lock prevents another TUI from writing during backup.
To restore, close the app and copy the backup's `memory.sqlite` and `sessions/`
into an **empty** directory, then run with `LOADSTONE_HOME` pointing there. Do not
merge SQLite files or omit live WAL files when making your own backups. Exports
are human-readable portable records; automated JSON import is not implemented.

For permanent local deletion, quit every instance and delete the companion's
`memory.sqlite` (and its `-wal`/`-shm` sidecars), `sessions/`, `exports/` and
`backups/` under the configured home. Preserve `cache/` if still using the CLI.
Provider retention is separate from local deletion. A fresh isolated
`LOADSTONE_HOME` is useful for testing without touching a real account.

Only one process may own a home at a time. A second TUI refuses to start. After a
hard crash, allow roughly 30 seconds for a stale heartbeat lock to expire before
reopening. Do not manually remove the lock while another instance is running.

## Architecture and durability

- `apps/tui`: Ink rendering, terminal sanitization, commands, lifecycle and lock.
- `packages/agent`: pi-durable adapter, Ironman instructions, wiki and memory tools.
- `packages/memory`: SQLite schema migration, typed facts, transaction validation,
  conflict review, history, undo, backup and character/session metadata.
- `packages/wiki-client`: existing wiki functions plus fresh RuneMetrics snapshots.

pi-durable and pi-ai are pinned to **1.4.0** because their APIs are experimental.
Upstream `main` already has different watch and continuation APIs; the adapter
intentionally uses the published 1.4.0 contract. In this version watches expose
active context; older transcript history is loaded through `entries()`.

The agent has no shell, arbitrary filesystem, approval, deletion, character-switch,
or cross-character tools. Wiki content is untrusted reference data. Memory is
read on each request, with detailed records retrieved on demand. Tool outputs are
bounded and wiki pages are paginated. A guard terminates tool rounds at round 12;
provider requests have bounded timeout/retries. Esc aborts execution. Crash-loop
parking is exposed as an error notice and `/retry` can retry parked tasks.

Memory and conversations use **separate SQLite transactions**, not an implied
cross-database atomic commit:

1. pi-durable commits the tool intent and stable evidence/sync snapshot memo.
2. Memory commits the entire update and a receipt keyed by **session UUID + task ID**.
3. pi-durable commits the tool result.

If the process stops between 2 and 3, the replay-safe tool returns the existing
receipt without changing memory again. Receipts survive undo, so replay cannot
reapply an undone operation. No increments or inferred acquisitions are replayed.
Manual commands use fresh operation UUIDs. Session metadata is stored before
opening its SQLite file, allowing an interrupted creation to reopen the same file.

Quit/close preserves unfinished work; Esc explicitly cancels it. Reopen may repeat
a model request (and incur cost), but cannot duplicate a committed memory effect.
pi-durable's SQLite backend guarantees ordinary process-crash consistency, not
that the newest conversation commit survives a power failure. Keep backups.

## Validation

```bash
pnpm run check-types
pnpm run lint
pnpm run test
pnpm run build
```

Tests use temporary databases, mocked HTTP, Ink's test renderer, and pi-ai's faux
provider. They exercise schema/value validation, character isolation, partial sync,
conflict review, undo, backup, tool evidence checks, chat streaming/cancellation,
and interruption **after a memory commit but before its durable tool result**.
No real provider credentials or paid model requests are needed for tests.

A real-model smoke check is still recommended with your chosen provider: ask for
wiki-backed advice, report a level/quest/item, inspect `/history`, undo a save, and
restart. Natural-language memory decisions are model-dependent; the scripted tests
verify the integration and policy, not every model's adherence to that policy.

Not included: OAuth onboarding, cloud sync, a deterministic complete quest dependency solver,
live bank access, embeddings/vector storage, or in-game automation.
