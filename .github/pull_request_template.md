## Summary

<!-- What problem does this solve? Why this approach? Keep the scope coherent. -->

## Validation

<!-- List commands actually run and their results. For behavior changes, describe
what the tests assert, plus any relevant manual checks. Do not check unrun tests. -->

- [ ] `pnpm run check` passes (types, lint, formatting, tests, production builds).
- [ ] Changed behavior has tests for relevant success, failure and edge cases.
- [ ] Desktop/package changes have appropriate smoke-test evidence, if applicable.

## Review checklist

- [ ] No unrelated refactors, speculative abstractions, or unnecessary dependencies.
- [ ] Types and runtime validation protect changed external boundaries; no casts or suppressions added just to bypass checks.
- [ ] Error handling/fallbacks are intentional; sensitive data is not exposed.
- [ ] Tests assert observable outcomes and isolate network/storage/mocks.
- [ ] Documentation and `tasks.md` reflect the actual state, if applicable.

## Limitations / remaining acceptance

<!-- Explicitly list untested platforms, live-provider flows, migration/security
risks, or unfinished work. Use "None" if there are no known limitations.
See CONTRIBUTING.md for the review standard. -->
