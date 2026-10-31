# Loadstone Tasks & Roadmap

Features and improvements planned to enhance the CLI for use with Ironman progress LLM agents.

## Ironman Companion TUI

- [x] **Ink app**: Chat, streaming/tool status, responsive sidebar, scrollable chat/memory views, character onboarding and session resume.
- [x] **Durable agent**: Pinned pi-durable integration, scoped wiki/memory tools, cancellation, model selection, replay-safe writes and bounded tool rounds.
- [x] **Character memory**: SQLite skills, quests, items, unlocks, goals, preferences and notes with provenance, atomic history, conflict review and undo.
- [x] **Safe RuneMetrics sync**: Fresh, independently validated skill/quest snapshots; unavailable data never erases progress.
- [x] **Local data controls**: Exclusive process lock, character export, full memory/session backup and documented restore/deletion.
- [x] **Companion tests/docs**: Temporary SQLite, faux-model agent and interruption tests, Ink/command tests, provider and privacy guide.
- [x] **Shared pi authentication**: Reuse existing ChatGPT OAuth via pi's public SDK and lock-protected refresh; pi model defaults, `/auth`, `/model pi`, and an explicit environment-only opt-out.
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
