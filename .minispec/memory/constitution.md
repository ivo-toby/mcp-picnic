# MCP Picnic Constitution

## Core Principles

### I. MCP Protocol Compliance

All tool, resource, and prompt implementations MUST conform to the
Model Context Protocol specification. Every handler MUST focus on a
single responsibility. Input validation MUST use Zod schemas.
Transport implementations (stdio, Streamable HTTP) MUST remain
interchangeable without affecting handler logic.

### II. Type Safety

TypeScript strict mode MUST be enabled. Avoid `any` when possible;
prefer explicit types, interfaces, and discriminated unions. Zod
schemas MUST be the single source of truth for runtime validation
and static types where applicable. All public functions and
interfaces MUST have JSDoc-style documentation.

### III. Testing Discipline

All new functionality MUST include unit tests using Vitest. Tests
MUST focus on behavior, not implementation details. See
`test/README.md` for testing guidelines. Tests MUST pass before
code is merged. Each handler's public API surface MUST be covered
by at least one test.

### IV. Simplicity

Follow YAGNI: do not add features, abstractions, or error handling
beyond what is directly required. Prefer three similar lines over a
premature abstraction. Do not design for hypothetical future
requirements. Bug fixes MUST NOT include unrelated refactoring.
Complexity MUST be justified in writing (plan or PR description)
before introduction.

### V. Code Quality

Prettier (100 char width, no semicolons, double quotes) and ESLint
MUST be applied to all source files. Imports MUST be ordered from
external to internal with related imports grouped. Naming
conventions: camelCase for variables/functions, PascalCase for
types/interfaces. All async functions MUST handle errors with
try/catch blocks.

## Technology Stack

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js (ESM modules)
- **MCP SDK**: `@modelcontextprotocol/sdk`
- **Upstream API**: `picnic-api` library
- **Validation**: Zod + zod-to-json-schema
- **Build**: esbuild (single bundle output)
- **Test**: Vitest
- **Formatting**: Prettier
- **Linting**: ESLint with typescript-eslint
- **Releases**: semantic-release

New dependencies MUST be justified. Prefer the existing stack over
introducing alternatives that serve the same purpose.

## Development Workflow

- **Build**: `npm run build`
- **Type Check**: `npm run typecheck`
- **Lint**: `npm run lint`
- **Test**: `npm test` (or `npx vitest run test/path/to/test.test.ts`)
- **Dev Mode**: `npm run dev`

All PRs MUST pass `typecheck`, `lint`, and `test` before merge.
Commit messages MUST follow conventional commits for
semantic-release compatibility. Each PR MUST be scoped to a single
concern (feature, fix, or refactor).

---

## MiniSpec Preferences

### Review Chunk Size

medium (40-80 lines per chunk)

### Documentation Review Policy

trust-ai (AI handles all documentation autonomously)

### Autonomy Level

familiar-areas (AI proceeds in code areas already reviewed this session)

### Design Evolution Handling

always-discuss (AI stops implementation to discuss any design deviation)

### Walkthrough Depth

quick (high-level architecture overview)

---

## Governance

This constitution is the authoritative reference for project
standards. All PRs and code reviews MUST verify compliance with
these principles. When a principle conflicts with practical
necessity, the deviation MUST be documented in the PR description
with rationale.

Amendments to this constitution require:
1. A written proposal describing the change and its rationale.
2. Update to this file with version increment per semver:
   - MAJOR: principle removal or backward-incompatible redefinition.
   - MINOR: new principle or material expansion of guidance.
   - PATCH: wording clarification or typo fix.
3. Propagation check across dependent templates.

MiniSpec preferences can be adjusted per-feature if needed without
a version bump.

Use `CLAUDE.md` for runtime development guidance that complements
but does not override this constitution.

**Version**: 1.0.0 | **Ratified**: 2026-03-06 | **Last Amended**: 2026-03-06
