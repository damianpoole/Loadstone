# Loadstone Tasks & Roadmap

Features and improvements planned to enhance the CLI for use with Ironman progress LLM agents.

## Repository Quality

- [x] **Enforced quality baseline**: Explicit lint rules for type escapes and common mistakes, no lint warnings/unused suppressions, TypeScript unused-code checks, shared `pnpm run check` entry point for local/mise/CI, typed legacy fixtures and contributor/PR review checklists.

## Desktop Companion

See [the desktop architecture and sequenced delivery plan](docs/desktop.md) for
implementation details, acceptance criteria, packaging commands and release blockers.

- [ ] **Slice 2 — graphical authentication and onboarding**: Implemented private OS-encrypted SDK credential storage, explicit shared-pi opt-in, offline first run, graphical API-key/browser/device/paste interactions, cancellation/timeout/logout and model/cost selection. Clean-Windows/live-provider acceptance and remaining typed-method/notice extraction still need validation/completion; see `docs/desktop.md`.
- [x] **Slice 1 — shared runtime and desktop vertical slice**: Electron/React app, shared application controller, validated sandboxed IPC, character/memory display, sync, streamed durable chat and restart restoration; unsigned installer configuration and Windows/macOS/Linux CI with packaged/installed-app smoke tests.
- [ ] **Slice 2 — onboarding/authentication**: Graphical provider login, private Loadstone credentials, explicit shared-pi consent, model discovery and structured non-terminal errors.
- [ ] **Slice 3 — player UI/data controls**: Memory review/history/undo, sessions/goals, exports/backups, accessibility, chat polish and performance validation alongside RS3.
- [ ] **Slice 4 — safe public distribution**: Signing/notarization, license notices, supported-platform validation, automatic updates, schema compatibility, consistent pre-migration backups and recovery tests.
- [ ] **Slice 5 — website/launch**: Signed downloads, setup/privacy/cost documentation, troubleshooting and an external-player pilot.

Slice 1 is an internal preview. Local macOS package tests do not establish other
platform compatibility; Windows NSIS and Ubuntu DEB installation tests run in CI.
Linux startup now has terminal diagnostics, visible-first restoration, graphics
backend overrides and a documented sandbox troubleshooting path.

## Ironman Companion TUI

- [x] **Ink app**: Chat, streaming/tool status, responsive sidebar, scrollable chat/memory views, character onboarding and session resume.
- [x] **Session picker**: Searchable title/ID autocomplete for `/resume`, `/sessions`, and `/session`, stable local opening-request titles, and migration/backfill for older sessions.
- [x] **Readable chat formatting**: Terminal Markdown for assistant responses, distinct cyan user messages, safe ANSI handling, and width-aware styled scrollback.
- [x] **Distinct tool output**: White text on a full-chat-width dark-grey background separates tool messages from chat, with safe wrapping, independent scrollback lines, and `NO_COLOR` support.
- [x] **Sidebar clarity**: Selected character name, explicit last-saved-facts labeling, and sync/user provenance rather than implying recent in-game activity.
- [x] **Slash-command autocomplete**: Filterable overlay above the prompt, wrapping arrow-key selection, Enter to fill (not execute), and Escape to dismiss without cancelling work.
- [x] **Conversation scrollback**: Mouse wheel/trackpad, arrow/page keys, Home/End, and a stable reading position during streamed responses; navigation never changes the draft.
- [x] **Durable agent**: Pinned pi-durable integration, scoped wiki/memory tools, cancellation, model selection, replay-safe writes and bounded tool rounds.
- [x] **Character memory**: SQLite skills, quests, items, unlocks, goals, preferences and notes with provenance, atomic history, conflict review and undo.
- [x] **Consecutive undo recovery**: Restore exact prior fact identity/provenance, retain separate linked undo receipts, and preserve stale-write guards and durable replay safety.
- [x] **Safe RuneMetrics sync**: Fresh, independently validated skill/quest snapshots; unavailable data never erases progress.
- [x] **Local data controls**: Exclusive process lock, character export, full memory/session backup and documented restore/deletion.
- [x] **Companion tests/docs**: Temporary SQLite, faux-model agent and interruption tests, Ink/command tests, provider and privacy guide.
- [x] **Shared pi authentication**: Reuse existing ChatGPT OAuth via pi's public SDK and lock-protected refresh; pi model defaults, `/auth`, `/model pi`, and an explicit environment-only opt-out.
- [x] **Outcome planning**: `/plan TARGET` researches areas, unlocks, items, boss preparation and quests; atomically saves root/nested goals, ordered acyclic dependencies, wiki sources and requirements. `/goals` computes readiness from character memory without inferring achieved progress; plan creation supports history, undo, export and durable replay.
- [ ] **Future companion improvements**: In-app OAuth login UI, optional save-everything confirmation mode, JSON import, and deterministic quest dependency planning.

## New Commands

- [x] **`category` command**: Implement `action=query&list=categorymembers` to allow the agent to discover sets of related pages (e.g., "Category:Novice quests", "Category:Tier 70 weapons").
- [x] **`profile` command**: A system to store local JSON profiles (stats, quest completions, ironman status) to provide user context to the LLM.
- [ ] **`training` command**: Specialized parsing for the Wiki's "Training" guides which are often very large and complex tables.

## Enhancements

- [x] **Improved Search**: Explore using `action=query&list=search` instead of `opensearch` for better relevance and snippet previews.
- [x] **Table Filtering**: Add options to the `page` command to only return specific tables (e.g., only "Drop sources" or only "Combat stats") to save even more tokens.
- [x] **Page JSON Filters**: Add headings-only output and selectable JSON fields to reduce LLM token usage.
- [ ] **Ironman-Specific Filters**: Proactively highlight or filter for Ironman-specific notes on pages (e.g., shop availability for Ironmen).

## Technical Debt / Tooling

- [x] **Caching Layer**: Implement a file-system cache (e.g., in `~/.loadstone/cache`) with a configurable TTL (default 24h) to speed up repeated requests and reduce API load.
- [x] **Tool Paths**: Provision Node.js and pnpm through mise and document pnpm's global bin setup.
- [x] **Binary Distribution**: Set up a build step to produce a single-file executable for easier installation.
- [x] **Dependency Security**: Upgrade to Vitest 5; Vite Plus now manages the test and packaging dependencies, replacing tsup and its esbuild override.

- [x] **Codex Skill Setup**: Document mise/pnpm-based local installation and Codex skill installation; correct headings examples and explain fresh profile queries and quest-data limitations.

- [x] **Tooling migration**: Use mise-pinned Node.js and pnpm, with Vite Plus for packaging, tests, linting, formatting, and workspace task execution.
