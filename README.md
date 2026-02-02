# Loadstone

A powerful CLI tool for accessing the [RuneScape 3 Wiki](https://runescape.wiki/), designed to assist Ironman players and power LLM agents with structured game data.

Built with **Bun**, **Turborepo**, and **TypeScript**.

## Features

- **Search**: Find pages with rich snippets.
- **Inspect Pages**: Fetch structured content (tables, stats, drop rates) from any wiki page.
- **Section Filtering**: extract only specific sections (e.g., "Drop sources") to save context.
- **Category Exploration**: Discover related pages (e.g., "Category:Novice quests").
- **Player Profile**: Fetch stats and quest data from RuneMetrics.
- **JSON Output**: All commands support `--json` for easy integration with LLMs.

## Installation

### Prerequisites
- [Bun](https://bun.sh/) (v1.0+)

### Setup
```bash
# Install dependencies
bun install

# Build the project
bun run build
```

## Usage

Run the CLI directly using Bun:

```bash
# Search for a page
bun apps/cli/src/index.ts search "Abyssal whip"

# View page content (text mode)
bun apps/cli/src/index.ts page "Abyssal whip"

# Get structured JSON for an LLM
bun apps/cli/src/index.ts page "Abyssal whip" --json

# Get only specific data (e.g., Drop Sources)
bun apps/cli/src/index.ts page "Abyssal whip" --section "Drop sources" --json

# List items in a category
bun apps/cli/src/index.ts category "Novice quests"

# Check player stats
bun apps/cli/src/index.ts profile "YourUsername"
```

## Project Structure

- `apps/cli`: The main command-line application.
- `packages/wiki-client`: Shared library for RS3 Wiki and RuneMetrics API interaction.
- `packages/tsconfig`: Shared TypeScript configuration.
- `packages/eslint-config`: Shared ESLint configuration.

## Development

This project uses [Turborepo](https://turbo.build/) to manage the workspace.

```bash
# Run dev mode (watch)
bun run dev

# Lint all packages
bun run lint
```
