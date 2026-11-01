# Loadstone

CLI tools and a persistent Ironman chat companion for the [RuneScape 3 Wiki](https://runescape.wiki/) and RuneMetrics, designed to assist Ironman players and power LLM agents with structured game data.

Built with **Node.js**, **pnpm**, **Vite Plus**, and **TypeScript**, with tools pinned by **mise**.

## Features

- **Search**: Find pages with rich snippets.
- **Inspect Pages**: Fetch structured content (tables, stats, drop rates) from any wiki page.
- **Section Filtering**: extract only specific sections (e.g., "Drop sources") to save context.
- **Category Exploration**: Discover related pages (e.g., "Category:Novice quests").
- **Player Profile**: Fetch stats and quest data from RuneMetrics.
- **JSON Output**: All commands support `--json` for easy integration with LLMs.
- **Caching**: File-system cache with TTL and optional custom directory.
- **Token Reduction**: Headings-only output and JSON field selection for smaller payloads.
- **Ironman TUI**: Ink chat with a pi-durable agent, wiki tools, resumable sessions, and local SQLite character memory. Automatic saves have provenance, conflict review, and undo.

## Installation

### For Users (Recommended)

Install directly from NPM to use the CLI globally:

```bash
pnpm add -g loadstone-rs3
```

_Note: Source builds require Node.js 24.19+ on the 24.x line, or Node.js 26+. The repository pins Node.js 24.19.0 with mise._

### For Developers (Source Code)

If you want to contribute or build locally:

1.  **Prerequisites**: [mise](https://mise.jdx.dev/). Activate mise in your shell; mise.toml pins Node.js and pnpm.
2.  **Setup**:
    ```bash
    git clone https://github.com/damianpoole/Loadstone.git
    cd Loadstone
    mise trust
    mise install
    pnpm install --frozen-lockfile
    pnpm run build
    ```
3.  **Link**:
    ```bash
    cd apps/cli
    pnpm link --global
    ```

Run `pnpm setup` if needed and ensure pnpm's global bin directory (`pnpm bin -g`) is on your PATH. The linked
`loadstone` command runs the local bundle through Node.js; rebuild after source changes.

### Codex skill

The reusable skill is maintained at `.opencode/skills/loadstone-cli/SKILL.md`
(with a Gemini variant under `.gemini/skills/`). To install it for Codex after
building and linking the CLI, run from the repository root:

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R .opencode/skills/loadstone-cli "${CODEX_HOME:-$HOME/.codex}/skills/"
```

If a skill is already installed, review local customizations before replacing it.
Provide your RuneScape character name explicitly when first querying your profile.
Use `--no-cache` for fresh progress checks. Normal skill output contains levels;
quest API failure may produce an empty list, so an empty list alone does not prove
that no quests are complete.

## Ironman companion (source builds)

```bash
# After installing workspace dependencies; requires an interactive terminal
# Reuses your existing pi login, including ChatGPT OAuth.
# Or use LOADSTONE_AUTH=env with a provider API key.
pnpm run tui
```

Start with `/character YourRSN`, then `/sync`. Chat about goals and progress; the
agent can save skills, quests, relevant items, unlocks, goals and preferences.
Use `/memory`, `/history`, `/pending` and `/undo ID` to inspect and correct saves.
Memory editing and RuneMetrics sync also work without model authentication.
Use `/auth` to inspect credential status and `/model pi` to switch an existing
session to pi's default model. Assistant responses render terminal Markdown, and
your messages appear in cyan to distinguish them from agent replies (`NO_COLOR=1`
disables styling).

See [the TUI guide](docs/ironman-tui.md) for provider configuration, keyboard controls,
backup/restore, privacy, recovery guarantees and architecture. The TUI is currently
run from this monorepo, not included in the published `loadstone-rs3` CLI package.

## Usage

Once installed, you can use the `loadstone` command anywhere:

```bash
# Search for a page
loadstone search "Abyssal whip"

# View page content (text mode)
loadstone page "Abyssal whip"

# Get structured JSON for an LLM
loadstone page "Abyssal whip" --json

# Get only section headings (for quick structure)
loadstone page "Abyssal whip" --json --headings

# Get a subset of sections to reduce tokens
loadstone page "Abyssal whip" --json --fields "Combat stats,Drop sources"

# Get only specific data (e.g., Drop Sources)
loadstone page "Abyssal whip" --section "Drop sources" --json

# List items in a category
loadstone category "Novice quests"

# Check player stats
loadstone profile "YourUsername"

# Get only skills (for specific level queries)
loadstone profile "YourUsername" --json --skills-only

# Get only completed quests
loadstone profile "YourUsername" --json --completed-quests-only

# Get only started quests (what to focus on)
loadstone profile "YourUsername" --json --started-quests-only

# Get only not-started quests
loadstone profile "YourUsername" --json --not-started-quests-only

# Get all quests with minimal data
loadstone profile "YourUsername" --json --quests-only

# Get full profile with raw API data
loadstone profile "YourUsername" --json --include-raw

# Cache controls
loadstone page "Abyssal whip" --cache-ttl 12
loadstone page "Abyssal whip" --cache-dir "~/.loadstone/cache"
loadstone page "Abyssal whip" --no-cache
```

## Project Structure

- `apps/cli`: The existing command-line application.
- `apps/tui`: Ink Ironman companion UI and commands.
- `packages/agent`: pi-durable runtime and scoped wiki/memory tools.
- `packages/memory`: SQLite character memory, history, review and undo.
- `packages/wiki-client`: Shared library for RS3 Wiki and RuneMetrics API interaction.
- `packages/tsconfig`: Shared TypeScript configuration.

## Development

This project uses pnpm workspaces and [Vite Plus](https://viteplus.dev/) for task execution, packaging, tests, linting, and formatting. Run `mise run check` for type checking, linting, tests, and a production build.

```bash
# Rebuild the CLI on source changes (run dist/index.js separately)
pnpm run dev

# Lint all packages
pnpm run lint

# Type check and test all packages
pnpm run check-types
pnpm run test

# Build and run the CLI
pnpm start --help
```
