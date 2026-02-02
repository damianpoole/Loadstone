# Loadstone Tasks & Roadmap

Features and improvements planned to enhance the CLI for use with Ironman progress LLM agents.

## New Commands
- [x] **`category` command**: Implement `action=query&list=categorymembers` to allow the agent to discover sets of related pages (e.g., "Category:Novice quests", "Category:Tier 70 weapons").
- [x] **`profile` command**: A system to store local JSON profiles (stats, quest completions, ironman status) to provide user context to the LLM.
- [ ] **`training` command**: Specialized parsing for the Wiki's "Training" guides which are often very large and complex tables.

## Enhancements
- [x] **Improved Search**: Explore using `action=query&list=search` instead of `opensearch` for better relevance and snippet previews.
- [x] **Table Filtering**: Add options to the `page` command to only return specific tables (e.g., only "Drop sources" or only "Combat stats") to save even more tokens.
- [ ] **Ironman-Specific Filters**: Proactively highlight or filter for Ironman-specific notes on pages (e.g., shop availability for Ironmen).

## Technical Debt / Tooling
- [ ] **Caching Layer**: Implement a file-system cache (e.g., in `~/.loadstone/cache`) with a configurable TTL (default 24h) to speed up repeated requests and reduce API load.
- [ ] **Global Bun Path**: Resolve the absolute path requirement for Bun by ensuring the local environment is properly sourced or providing a wrapper script.
- [x] **Binary Distribution**: Set up a build step to produce a single-file executable for easier installation.
