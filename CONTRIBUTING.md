# Contributing to Loadstone

Keep changes small, understandable, and supported by evidence. A green build is
necessary, not proof that a design is good or a feature is complete.

## Local validation

Use the Node and pnpm versions pinned in `mise.toml`. Use pnpm only.

```bash
mise trust && mise install
pnpm install --frozen-lockfile
pnpm run check
# Equivalent entry point when using mise:
mise run check
```

`pnpm run check` runs, in order:

1. `check-types` — workspace TypeScript checks, including tests.
2. `lint` — Vite Plus/Oxlint; warnings and unused suppression directives fail.
3. `format:check` — Vite Plus formatting, without rewriting files.
4. `test` — all workspace Vitest suites.
5. `build` — production builds of the CLI, TUI, and desktop app.

Use `pnpm run format` to format changes before checking. Individual commands remain
available for fast iteration. CI runs the same aggregate check on Windows, macOS
and Linux, then builds desktop installers and runs packaged/installed-app smoke
tests. For desktop changes, also run `pnpm run desktop:smoke` after building;
see [the desktop guide](docs/desktop.md) for packaged tests and manual acceptance.

## Enforced baseline

- Shared TypeScript configuration enables `strict`, `noUnusedLocals` and
  `noUnusedParameters`. Prefix an intentionally unused callback parameter with
  `_`; remove dead declarations rather than disguising them.
- Explicit `any` is an error in production **and test code**. Prefer `unknown`
  plus validation for untrusted input; use concrete types for known contracts,
  `vi.mocked`/typed mocks, and real `Response` objects for fetch fixtures.
- `@ts-ignore` and `@ts-nocheck` are forbidden. An intentional `@ts-expect-error`
  must explain what error is expected and why (for example, a negative type test).
- No `debugger`, `var`, empty blocks, or avoidable `let`. Equality must be strict;
  `== null` / `!= null` are allowed as deliberate null-or-undefined checks.
- Oxlint's default correctness rules remain enabled. Rule definitions live in
  root `vite.config.ts`; package checks must not weaken them.
- A necessary lint suppression must be narrow and include a reason using
  `// oxlint-disable-next-line <rule> -- <reason>`. Do not exempt whole test files
  or add casts through `unknown` merely to silence a diagnostic. An unused
  suppression fails lint. Intentional empty catches need an explanatory comment;
  silently ignoring a failure is not an error-handling strategy.

These checks do **not** enforce runtime API validation, exhaustively check async
handling, measure coverage, or audit dependencies. A typed JSON contract alone is
not validation. Type-aware lint rules, coverage thresholds, security gates and
GitHub branch protection require separate, deliberate configuration; don't
assume they exist because tests pass.

## Review standard

- **Scope:** one coherent change; no speculative abstractions, unrelated cleanup,
  dependency upgrades, generated output, or hand-edited lockfiles.
- **Design:** follow existing package boundaries. Prefer direct code; introduce
  shared machinery only for a demonstrated need. Explain non-obvious trade-offs.
- **Boundaries:** validate IPC, API and persisted data before trusting it. Avoid
  unchecked assertions, credential exposure, and raw provider error dumps.
- **Errors:** make failure, cancellation and partial availability explicit. A
  fallback must be intentional and tested, not success-shaped missing data.
- **Tests:** assert observable results, not just mock calls. Cover relevant invalid
  input, failure, cancellation, persistence/restart and compatibility cases. Mock
  network services; use isolated temporary storage and restore mocks.
- **Claims:** distinguish implementation, automated checks and manual acceptance.
  Record untested platforms/provider flows and keep incomplete acceptance work
  open in `tasks.md`. Never use a test count as a substitute for reviewing tests.

Use the PR template to provide evidence and call out limits. Review the
repository-specific conventions in [AGENTS.md](AGENTS.md) as well.
