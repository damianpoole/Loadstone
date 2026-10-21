---
name: loadstone-cli
description: Use the Loadstone CLI to search the RuneScape 3 Wiki for quests or item information and RuneMetrics for character information like levels, status, quests completion. Use when the user asks for RS3 wiki data, Ironman-focused answers, RuneMetrics stats, or when they want CLI command guidance for Loadstone.
metadata:
  author: loadstone
  version: "1.1"
---

# Loadstone CLI Skill

Use this skill to operate the Loadstone CLI in this repository and return data from the RuneScape 3 Wiki or RuneMetrics in a user-friendly format.

## When to use

- User asks for RS3 Wiki data (pages, categories, tables, training info)
- User asks for RuneMetrics profile or quest info
- User asks how to run or interpret Loadstone CLI commands
- User wants structured JSON output for LLM consumption

## Required context

- Use current RuneScape 3 data, not OSRS methods. Prefer fresh CLI results over earlier conversation levels or resource counts; RuneMetrics does not report bank contents or equipment.
- Resolve the character name from an explicit user statement or local configuration. Ask if missing; never infer it from the operating-system username.
- Prefer `--json` for data retrieval. Use `--no-cache` when checking current progress or current Wiki requirements; the default cache TTL is 24 hours.
- Skill values in normal profile output are levels, not per-skill XP. Do not infer exact remaining XP from a level.
- Separate verified data from estimates, especially training times.

## Command usage

> [!IMPORTANT]
> The `loadstone` command MUST be available on the user's PATH. Do not attempt to run it via `bun run`, `npm run`, or by pointing to source files directly.

```bash
loadstone <command> [args] [options]
```

Check availability with `command -v loadstone` and inspect `loadstone --help` for supported commands. If missing, locate the user's checkout and follow its README source-install instructions using Bun. The bundled executable requires Node.js. Do not silently install a different published version.

## Profile data workflow

For token-efficient profile queries, use the filtering options:

- Use `--skills-only` for skill level queries (e.g., "what's my crafting level?") - reduces ~14k tokens to ~300
- Use `--completed-quests-only` for completed quest counts
- Use `--started-quests-only` for current quest progress
- Use `--not-started-quests-only` for available quests to start
- Use `--quests-only` for all quests with minimal data
- Add `--include-raw` if you need the complete raw API response

**Note:** The `raw` field is excluded by default in JSON mode to save tokens. Use `--include-raw` only when necessary.

Examples:

```bash
# Get only skill levels
loadstone profile "Some Player" --json --skills-only --no-cache
```

```bash
# Get only completed quests
loadstone profile "Some Player" --json --completed-quests-only --no-cache
```

```bash
# Get only started quests
loadstone profile "Some Player" --json --started-quests-only --no-cache
```

## Page content workflow

- First request available headings with `--json --headings`.
- Choose only the headings relevant to the user request.
- Request those sections with `--fields "Heading 1,Heading 2"`.

Examples:

```bash
loadstone page "Abyssal whip" --json --headings --no-cache
```

```bash
loadstone page "Abyssal whip" --fields "Usage,Drop sources" --json --no-cache
```

## Output handling

- If the user asks for data, prefer `--json` and return structured results.
- If the user asks for a summary, parse JSON and provide a concise summary.
- Inspect both JSON and stderr: a command may exit successfully while returning an error object. A private or unavailable profile is not a zero-level account.
- Quest API failure can currently produce an empty quest list without an error. Treat an empty list as unverified, not proof of no completed quests; compare full-profile quest counters and report the limitation if necessary.
- If a command fails, report the failure (missing command, network, rate limit). Do not present cached or remembered data as freshly verified.
- Cite the returned Wiki URL when using its information in an answer.
