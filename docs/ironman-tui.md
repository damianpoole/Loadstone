# Ironman companion TUI

Loadstone now has a chat-first **Ink** application in `apps/tui`, an agent powered by
**@earendil-works/pi-durable**, and a local SQLite character-memory repository.
The existing CLI and its JSON output remain independent.

## Start

Use the repository's pinned Node.js and pnpm versions:

```bash
mise trust && mise install
pnpm install --frozen-lockfile

# Choose ONE provider and supply its key through your shell/secret manager.
export LOADSTONE_PROVIDER=openai
export LOADSTONE_MODEL=gpt-4o-mini
# Set OPENAI_API_KEY securely in your environment; do not paste it into chat.
pnpm run tui
```

The TUI requires an interactive terminal. `pnpm --filter loadstone-tui start --help`
prints setup and command help without requiring one. After building, run
`node apps/tui/dist/index.js` directly. Keep the installed workspace dependencies
and all files in `dist/`: this is an ESM application with chunks, not a standalone binary.

Supported providers:

| Provider     | Environment variable | Example model                            |
| ------------ | -------------------- | ---------------------------------------- |
| `openai`     | `OPENAI_API_KEY`     | `gpt-4o-mini`                            |
| `anthropic`  | `ANTHROPIC_API_KEY`  | `claude-sonnet-4-5`                      |
| `openrouter` | `OPENROUTER_API_KEY` | Use `/models openrouter` for catalog IDs |

`/models FILTER` lists the pinned pi-ai catalog. `/model PROVIDER MODEL_ID` changes
the current conversation and the default for new sessions. `LOADSTONE_PROVIDER`
and `LOADSTONE_MODEL` override defaults for **new** sessions; existing sessions
retain their chosen model. Restart after changing credentials. The app does not
read pi coding-agent credentials or implement OAuth login.

You can create characters, edit/browse memory, export/backup, and sync RuneMetrics
without a model key. Only chat needs one. There are no background model calls for
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

You see saved memory operations in the transcript, recent facts in the sidebar,
and pending conflicts in the header. `/history` includes full receipts and evidence.
The UI shows “saved” only after the SQLite transaction commits.

## Controls and commands

- **Enter:** send a message/command. Paste text, then press Enter to send.
- **Esc:** cancel the active agent run or manual RuneMetrics sync. Cancelling does
  not undo already committed memory; use `/undo` if needed.
- **PageUp / PageDown:** scroll the current view.
- **Tab:** switch between chat and the memory view.
- **Ctrl+C / `/quit`:** orderly shutdown, preserving unfinished agent work for resume.
- Wide terminals show a character/goals/recent-memory sidebar; narrow ones show chat only.

| Command                                        | Purpose                                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| `/help`                                        | Show help                                                                     |
| `/character [RSN]`                             | List or select/create characters                                              |
| `/create MODE RSN`                             | Create an Ironman, hardcore, or group-ironman                                 |
| `/sync`                                        | Fresh skills and quests from RuneMetrics                                      |
| `/memory [query]`                              | Search facts with provenance                                                  |
| `/goals [query]`                               | Browse goals                                                                  |
| `/history`                                     | Last 30 operations, including previous values                                 |
| `/pending`                                     | Inspect proposed changes and conflicts                                        |
| `/approve ID`, `/reject ID`                    | Resolve a pending proposal explicitly                                         |
| `/undo ID`                                     | Reverse a saved operation if its affected facts have not changed since        |
| `/set KIND KEY = JSON`                         | Manually set/correct a fact                                                   |
| `/forget KIND KEY`                             | Propose deletion; requires `/approve ID`                                      |
| `/new`                                         | New conversation, retaining character memory                                  |
| `/sessions`                                    | List the active character's sessions                                          |
| `/resume SESSION_ID`                           | Open one of those sessions                                                    |
| `/earlier`                                     | Load 50 older stored entries, including history before compaction             |
| `/retry`                                       | Retry parked crash-loop tasks, or send an explicit continuation after failure |
| `/models [filter]`, `/model PROVIDER MODEL_ID` | Model configuration                                                           |
| `/export`                                      | Export character facts and audit history to a private JSON file               |
| `/backup`                                      | Consistent local backup of all character memory and sessions                  |

While the agent is working, read-only inspection is available, but new messages,
manual edits, sync, and character/session changes require cancellation first. No
hidden queue of messages can unexpectedly modify another character.

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

Not included: OAuth onboarding, cloud sync, a complete quest dependency planner,
live bank access, embeddings/vector storage, or in-game automation.
