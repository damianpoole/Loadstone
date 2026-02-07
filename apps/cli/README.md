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
