# AGENTS.md - Coding Agent Guidelines

This document provides essential information for AI coding agents working with the Loadstone repository to ensure consistent, high-quality contributions.

## Project Overview

**Loadstone** is a CLI tool for accessing the RuneScape 3 Wiki, designed to assist Ironman players and power LLM agents with structured game data. It's built as a Vite Plus monorepo using:

- **Runtime**: Node.js (pinned in mise.toml)
- **Language**: TypeScript (strict mode)
- **Monorepo**: Vite Plus
- **CLI Framework**: Commander.js
- **HTML Parsing**: Cheerio

## Project Structure

```
loadstone/
├── apps/
│   └── cli/              # Main CLI application
│       ├── src/
│       │   ├── commands/ # Individual command implementations
│       │   └── index.ts  # CLI entry point (Commander.js setup)
│       ├── package.json
│       └── vite.config.ts
├── packages/
│   ├── wiki-client/      # Shared library for Wiki/RuneMetrics API
│   └── tsconfig/         # Shared TypeScript configs
├── package.json          # Root workspace config
├── vite.config.ts        # Vite Plus configuration
├── mise.toml             # Pinned Node.js and pnpm tools
├── pnpm-workspace.yaml   # Workspace packages and toolchain catalog
└── tasks.md             # Feature roadmap and TODOs
```

## Key Conventions

### 1. Package Manager: **pnpm Only**

- **Always use `pnpm` commands**, never `npm` or `yarn`
- Install dependencies: `pnpm install`
- Run scripts: `pnpm run <script>`
- Build and execute via Node.js: `pnpm start` (from apps/cli)
- Run `mise trust && mise install` to provision pinned Node.js and pnpm. The project uses `pnpm-lock.yaml` (not `package-lock.json` or `yarn.lock`)

### 2. Workspace Dependencies

When adding dependencies:

- **CLI app** (`apps/cli`): Use regular npm packages
- **Shared packages** (`packages/*`): Reference workspace packages with `workspace:*`
  ```json
  {
    "dependencies": {
      "@loadstone/wiki-client": "workspace:*"
    }
  }
  ```

### 3. TypeScript Configuration

- **Strict mode enabled**: All TypeScript code must be type-safe
- **Module system**: ESNext modules with bundler resolution
- **Base config**: Extend from `@loadstone/tsconfig/base.json`
- **No `any` types**: Use `eslint-disable-next-line @typescript-eslint/no-explicit-any` only when absolutely necessary (e.g., external API responses)

### 4. Command Implementation Pattern

Each command follows this structure:

```typescript
// apps/cli/src/commands/command-name.ts
import chalk from "chalk";
import { functionFromWikiClient } from "@loadstone/wiki-client";

export async function commandName(args: string, options: Options) {
  // 1. User feedback with chalk
  console.log(chalk.blue(`Processing: ${args}...`));

  // 2. Call wiki-client function
  const result = await functionFromWikiClient(args, options);

  // 3. Handle errors gracefully
  if (!result) {
    console.log(chalk.yellow("No results found."));
    return;
  }

  // 4. Format output (text or JSON)
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    // Pretty-print with chalk
    console.log(chalk.green(`Found: ${result.title}`));
  }
}
```

### 5. CLI Command Registration

Commands are registered in `apps/cli/src/index.ts`:

```typescript
program
  .command("command-name")
  .description("Description for help text")
  .argument("<arg>", "Argument description")
  .option("-j, --json", "Output results as JSON")
  .option("-o, --option <value>", "Option description", "default")
  .action(commandName);
```

### 6. Wiki Client Functions

The `packages/wiki-client/src/index.ts` contains reusable API functions:

- `searchWiki(query: string)`: Search the wiki
- `getPage(title: string, options)`: Fetch page content
- `getCategoryMembers(category: string, options)`: List category members
- `getRSProfile(username: string)`: Fetch RuneMetrics profile
- `parseWikiContent(html: string)`: Parse HTML into structured sections

**When adding new wiki functionality:**

1. Add the function to `packages/wiki-client/src/index.ts`
2. Export it from the package
3. Import and use it in the CLI command

### 7. HTML Parsing Guidelines

The `parseWikiContent` function:

- Removes noise: `style`, `script`, `noscript`, `.navbox`, `.mw-editsection`
- Converts tables to pipe-delimited format
- Converts lists to bullet points
- Organizes content by H2 headers into sections
- Always clean HTML before parsing to reduce token overhead

**When parsing wiki content:**

- Use Cheerio (`cheerio`) for DOM manipulation
- Remove navigation boxes and edit links
- Convert tables to readable formats (CSV-like or pipe-delimited)
- Preserve structure with section headers

### 8. JSON Output Format

All commands support `--json` flag for LLM consumption:

- Return structured objects, not formatted strings
- Include all relevant data fields
- Use consistent naming (camelCase)
- For page content, return sections as key-value pairs

### 9. Error Handling

- **API errors**: Log with `console.error()` and return `null` or empty array
- **User-facing errors**: Use `chalk.yellow()` for warnings, `chalk.red()` for errors
- **Graceful degradation**: If optional data fails (e.g., quests API), continue with available data

### 10. Testing with Vitest

The project uses **Vitest** for unit testing. All code changes must include tests and pass validation.

**Test Structure:**

- Test files: `*.test.ts` alongside source files
- Location: Same directory as the code being tested
- Framework: Vitest with TypeScript support

**Writing Tests:**

```typescript
// Example: packages/wiki-client/src/parseWikiContent.test.ts
import { describe, it, expect } from "vite-plus/test";
import { parseWikiContent } from "./index";

describe("parseWikiContent", () => {
  it("should parse simple HTML with sections", () => {
    const html = `<div class="mw-parser-output"><h2>Section</h2><p>Content</p></div>`;
    const result = parseWikiContent(html);
    expect(result).toHaveProperty("Section");
    expect(result["Section"]).toContain("Content");
  });
});
```

**Testing CLI Commands:**

CLI command tests should mock dependencies:

```typescript
// Example: apps/cli/src/commands/search.test.ts
import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { search } from "./search";
import * as wikiClient from "@loadstone/wiki-client";

vi.mock("@loadstone/wiki-client");
vi.mock("chalk", () => {
  const mockChalk = (str: string) => str;
  mockChalk.blue = mockChalk;
  mockChalk.green = mockChalk;
  // ... other chalk methods
  return { default: mockChalk };
});

describe("search command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn<typeof console, "log">>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("should display search results", async () => {
    vi.mocked(wikiClient.searchWiki).mockResolvedValueOnce([...]);
    await search("query");
    expect(consoleSpy).toHaveBeenCalled();
  });
});
```

**Running Tests:**

```bash
# Run all tests
pnpm run test

# Run tests in watch mode
pnpm run test:watch

# Run tests for a specific package
cd packages/wiki-client
pnpm run test
```

**Test Coverage:**

- **Wiki client functions**: Test all exported functions with various inputs
- **CLI commands**: Test all command options and error cases
- **Edge cases**: Test error handling, empty results, invalid inputs
- **Mock external APIs**: Use `vi.mock()` and `global.fetch` mocking for API calls

**Important Testing Notes:**

- Mock `chalk` to return plain strings (supports method chaining: `chalk.bold.green`)
- Mock `@loadstone/wiki-client` functions in CLI command tests
- Mock `global.fetch` for API function tests
- Use `vi.spyOn(console, "log")` to capture CLI output
- Clean up mocks in `afterEach()` hooks

### 11. Building and Distribution

- **Build tool**: `vp pack` (configured in `apps/cli/vite.config.ts`)
- **Build command**: `pnpm run build` (runs via Vite Plus)
- **Output**: `dist/index.js` (CommonJS, bundled, executable)
- **Shebang**: Automatically added (`#!/usr/bin/env node`)
- **Dependencies**: Bundled (no external deps needed)

## Development Workflow

### Adding a New Command

1. **Create command file**: `apps/cli/src/commands/new-command.ts`

   ```typescript
   export async function newCommand(args: string, options: Options) {
     // Implementation
   }
   ```

2. **Add wiki-client function** (if needed): `packages/wiki-client/src/index.ts`

   ```typescript
   export async function newWikiFunction(...) {
     // API call and parsing
   }
   ```

3. **Register command**: `apps/cli/src/index.ts`

   ```typescript
   import { newCommand } from "./commands/new-command";
   program.command("new-command")...action(newCommand);
   ```

4. **Write tests**: Create `new-command.test.ts` with comprehensive test cases
   - Test success cases
   - Test error handling
   - Test JSON output option
   - Mock dependencies appropriately

5. **Test locally**:
   - Run tests: `pnpm run test`
   - Run dev mode: `pnpm run dev` (watch mode)
   - Manual test: `pnpm run start`

6. **Build**: `pnpm run build` (from root)

7. **Verify**: Ensure `pnpm run test` and `pnpm run lint` both pass

### Running Commands Locally

```bash
# Development mode (watch)
pnpm run dev

# Run directly
cd apps/cli
pnpm start search "Abyssal whip"

# After building
cd apps/cli
./dist/index.js search "Abyssal whip"
```

### Testing Changes

**⚠️ CRITICAL: All changes MUST pass tests and type checking before completion.**

1. **Type checking**: `pnpm run check-types` from the root (separate from tests)
2. **Unit tests**: `pnpm run test` (from root, runs via Vite Plus)
3. **Linting**: `pnpm run lint` (from root, runs via Vite Plus)
4. **Manual testing**: Run commands with various inputs
5. **JSON output**: Test with `--json` flag for LLM compatibility

**Validation Requirements:**

- ✅ All tests must pass: `pnpm run test`
- ✅ TypeScript must compile without errors: `pnpm run check-types` (separate from tests)
- ✅ No linting errors: `pnpm run lint`
- ✅ All new code must have corresponding tests

## Common Patterns

### Fetching Wiki Data

```typescript
const url = new URL("https://runescape.wiki/api.php");
url.searchParams.append("action", "query"); // or "parse"
url.searchParams.append("format", "json");
// ... add other params

const response = await fetch(url.toString());
if (!response.ok) {
  throw new Error(`Wiki API error: ${response.statusText}`);
}
const data = await response.json();
```

### Parsing Wiki HTML

```typescript
import { parseWikiContent } from "@loadstone/wiki-client";

const sections = parseWikiContent(html);
// Returns: { "Section Name": "content...", ... }
```

### Handling Options

```typescript
interface Options {
  json?: boolean;
  section?: string;
  limit?: number;
}

export async function command(args: string, options: Options) {
  const result = await fetchData(args, {
    limit: options.limit ? parseInt(options.limit) : 50,
  });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    // Pretty print
  }
}
```

## Important Notes

### ⚠️ Do NOT:

1. **Don't use npm/yarn**: Always use `pnpm`
2. **Don't modify `pnpm-lock.yaml` manually**: Let pnpm manage it
3. **Don't add `node_modules` to git**: Already in `.gitignore`
4. **Don't commit `dist/` files**: Build artifacts are gitignored
5. **Don't use `any` without justification**: Type everything properly
6. **Don't skip error handling**: Always handle API failures gracefully
7. **Don't hardcode API URLs**: Use constants (e.g., `BASE_URL`)

### ✅ DO:

1. **Use workspace dependencies**: `workspace:*` for internal packages
2. **Follow existing patterns**: Match the style of existing commands
3. **Add JSON output support**: All commands should support `--json`
4. **Use chalk for output**: Colorize user-facing messages
5. **Clean HTML before parsing**: Remove noise to reduce tokens
6. **Export types**: Export interfaces/types from wiki-client
7. **Update tasks.md**: Mark completed features in the roadmap
8. **Write tests for all new code**: Every function and command must have tests
9. **Ensure tests pass**: Run `pnpm run test` before completing any changes
10. **Verify TypeScript compliance**: Ensure `pnpm run check-types` passes

## Vite Plus Considerations

- **Workspace tasks**: Root scripts use `vp run -r` for builds and tests.
- **Configuration**: Package `vite.config.ts` files define packaging and tests; the root config defines linting and formatting.
- **Parallel execution**: Vite Plus runs tasks in parallel when possible
- **Workspace awareness**: Always run commands from root, Vite Plus handles workspace execution

## API Endpoints

### RuneScape Wiki API

- **Base URL**: `https://runescape.wiki/api.php`
- **Actions**: `query`, `parse`
- **Formats**: Always use `format=json`

### RuneMetrics API

- **Profile**: `https://apps.runescape.com/runemetrics/profile/profile?user={username}&skillvalues`
- **Quests**: `https://apps.runescape.com/runemetrics/quests?user={username}`

## Code Style

- **Indentation**: 2 spaces
- **Quotes**: Double quotes for strings
- **Semicolons**: Yes
- **Trailing commas**: Yes (in objects/arrays)
- **Line length**: Reasonable (no hard limit, but be sensible)

## Future Enhancements

See `tasks.md` for planned features:

- Training command (parsing training guides)
- Caching layer (`~/.loadstone/cache`)
- Ironman-specific filters
- Table filtering improvements

When implementing these, follow the patterns established in existing commands.

## Questions?

If you're unsure about:

- **Architecture decisions**: Check existing commands for patterns
- **API usage**: See `packages/wiki-client/src/index.ts` for examples
- **CLI patterns**: See `apps/cli/src/index.ts` and command files
- **TypeScript config**: See `packages/tsconfig/base.json`

---

**Last Updated**: 2026-02-02
**Maintainer**: Review `README.md` and `tasks.md` for project context

## Pre-Commit Checklist

Before completing any changes, ensure:

- [ ] All tests pass: `pnpm run test`
- [ ] TypeScript compiles: `pnpm run check-types` (separate from tests)
- [ ] Linting passes: `pnpm run lint`
- [ ] New code has corresponding tests
- [ ] Tests cover edge cases and error handling
- [ ] Code follows existing patterns and conventions
- [ ] JSON output works correctly (if applicable)
- [ ] Error messages are user-friendly
