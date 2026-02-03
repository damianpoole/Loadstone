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

### For Users (Recommended)

Install directly from NPM to use the CLI globally:

```bash
npm install -g loadstone-rs3
```

_Note: Requires Node.js installed on your system._

### For Developers (Source Code)

If you want to contribute or build locally:

1.  **Prerequisites**: [Bun](https://bun.sh/) (v1.0+)
2.  **Setup**:
    ```bash
    git clone https://github.com/yourusername/loadstone.git
    cd loadstone
    bun install
    bun run build
    ```
3.  **Link**:
    ```bash
    cd apps/cli
    npm link
    ```

## Usage

Once installed, you can use the `loadstone` command anywhere:

```bash
# Search for a page
loadstone search "Abyssal whip"

# View page content (text mode)
loadstone page "Abyssal whip"

# Get structured JSON for an LLM
loadstone page "Abyssal whip" --json

# Get only specific data (e.g., Drop Sources)
loadstone page "Abyssal whip" --section "Drop sources" --json

# List items in a category
loadstone category "Novice quests"

# Check player stats
loadstone profile "YourUsername"
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
