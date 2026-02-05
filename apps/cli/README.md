# Loadstone RS3 CLI

CLI for accessing the RuneScape 3 Wiki with structured output for LLM workflows.

## Install

```bash
npm install -g loadstone-rs3
```

## Usage

```bash
# Search for a page
loadstone search "Abyssal whip"

# View page content (text mode)
loadstone page "Abyssal whip"

# Get structured JSON for an LLM
loadstone page "Abyssal whip" --json

# Get only section headings
loadstone page "Abyssal whip" --json --headings

# Get a subset of sections
loadstone page "Abyssal whip" --json --fields "Combat stats,Drop sources"

# Filter to a section (fuzzy match)
loadstone page "Abyssal whip" --section "Drop sources" --json

# List items in a category
loadstone category "Novice quests"

# Check player stats
loadstone profile "YourUsername"

# Cache controls
loadstone page "Abyssal whip" --cache-ttl 12
loadstone page "Abyssal whip" --cache-dir "~/.loadstone/cache"
loadstone page "Abyssal whip" --no-cache
```
