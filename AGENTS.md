<agent-guidelines title="Verifiable Thinking">

<section name="Code Organization">

<subsection name="Module Structure">

The codebase is organized into layered domain modules under `src/`:

```
src/
├── index.ts          # Entry point (MCP server)
├── infra/            # L0: Zero internal deps (LRUCache, ContentHashCache)
├── text/             # L0.5: Depends on infra (compression, tokens, extraction, patterns)
├── math/             # L1: Zero internal deps (AST, operators, tokenizer)
├── domain/           # L1: Depends on math, compute (detection, verification)
├── compute/          # L2: Depends on domain (solvers, classifier, registry)
├── session/          # L2: Depends on infra (manager, concepts)
├── judge/            # L2: Zero internal deps (LLM-as-judge)
├── think/            # L3: Depends on text, domain, compute, session
├── tools/            # L4: Interface layer (scratchpad, compress, sessions)
└── resources/        # L4: Interface layer (MCP resources)
```

**Dependency layers are strict — no circular deps allowed.**

</subsection>

<subsection name="Where New Code Goes">

- **Infrastructure** (caches, data structures) → `src/infra/`
- **Text processing** (compression, tokenization, extraction) → `src/text/`
- **Math operations** (AST, parsing, operators) → `src/math/`
- **Domain detection & verification** → `src/domain/`
- **Compute/solvers** (arithmetic, formulas, word problems) → `src/compute/`
- **Session management** (thought records, concepts) → `src/session/`
- **Reasoning orchestration** (routing, complexity, guidance) → `src/think/`
- **MCP tool definitions** → `src/tools/`
- **MCP resources** → `src/resources/`

</subsection>

<subsection name="Import Rules">

1. **Lower layers must not import from higher layers**
2. **Each module has a barrel `index.ts`** — prefer importing from the barrel
3. **Direct file imports are fine within a module** (e.g., `./helpers.ts`)
4. **Cross-module imports use the module path** (e.g., `../domain/verification.ts`)

</subsection>

<subsection name="Why This Matters">

1. **Single source of truth** — Fixes apply everywhere
2. **Testable** — Shared code gets unit tested in `test/`
3. **The tool uses it** — Logic must be importable, not buried in runners

</subsection>

<subsection name="Pattern">

```typescript
// BAD: Duplicating in runner.ts
function extractAnswer(response: string): string {
  // ... 50 lines of logic that should be shared
}

// GOOD: Import from the appropriate module
import { extractAnswer } from "../../src/text/extraction.ts";
```

</subsection>

</section>

<section name="Tool Architecture">

<subsection name="MCP Tools in src/tools/">

Each tool should be self-contained and use shared libraries:

- `scratchpad.ts` — Structured reasoning with guidance
- `sessions.ts` — Session management
- `compress.ts` — Text compression

</subsection>

<subsection name="New Features Go in Modules First">

When adding new capabilities:

1. **Add shared logic to the appropriate module** — The reusable algorithm/detection
2. **Add tool in `src/tools/`** — Expose via MCP for LLM to call
3. **Update benchmarks to use the module** — Not duplicate the logic

Example: Complexity assessment
```typescript
// src/think/complexity.ts - The algorithm
export function assessPromptComplexity(text: string): ComplexityResult { ... }

// src/tools/scratchpad.ts - Exposed via tool response
// The think tool can include complexity metadata in its response

// examples/benchmarks/runner.ts - Uses the module
import { estimateBudgetLocal } from "../../src/think/complexity";
```

</subsection>

</section>

<section name="Complexity-Based Routing">

The `src/think/complexity.ts` module provides O(n) complexity assessment:

- **Low** → direct answer (1 LLM call)
- **Moderate** → reasoning prompt (1 LLM call)
- **High** → reasoning + spot-check for trap patterns (1-2 LLM calls)
- **Very Hard / Almost Impossible** → reasoning + spot-check (2 LLM calls)

This replaces LLM-based budget estimation, saving ~500ms per question.

</section>

<section name="Explanatory Questions">

Questions starting with "explain", "describe", "compare" are detected as explanatory:

- **Skip verification** — spot-check hurts open-ended quality
- **Domain-aware prompts** — `src/think/prompts.ts` provides domain-specific steering
- **No expected answer** — use `expected_answer: null` in questions.json for judge-only evaluation

</section>

<section name="Response Processing">

The `src/text/extraction.ts` module handles:

- **Thinking tag removal** — strips `<think>...</think>` tags from model responses
- **Answer extraction** — priority-based pattern matching for structured answers
- **Markdown stripping** — cleans formatting for comparison

</section>

<section name="Benchmark Configuration">

The benchmark runner loads `.env` from project root via dotenv. Key variables:

- `LLM_MODEL` — Model name for API calls
- `LLM_BASE_URL` — API endpoint
- `LLM_API_KEY` — Authentication

Note: `examples/benchmarks/.env` overrides root `.env` if present (Bun loads from cwd first).

</section>

<critical-rules title="⚠️ MUST FOLLOW">

<rule number="1" name="Never Duplicate Logic">

If you write a function that could be reused:
- **STOP** — check if it exists in the appropriate module
- If it doesn't exist, **add it there first**
- Import it everywhere else

Violations create drift where fixes don't propagate.

</rule>

<rule number="2" name="Tests Are Non-Negotiable">

Before any PR:
```bash
bun test --timeout 60000
```

- **All 1,967+ tests must pass**
- New features require new tests in `test/`
- Test file naming: `<module>.test.ts`

</rule>

<rule number="3" name="Type Safety Is Required">

```bash
bunx tsc --noEmit
```

- **Zero type errors allowed**
- No `any` without explicit justification comment
- Use `as` casts sparingly and only after null checks

</rule>

<rule number="4" name="Preserve O(n) Complexity">

The routing and domain detection are intentionally O(n) single-pass:
- **Do NOT add nested loops** to `complexity.ts`, `detection.ts`, or `route.ts`
- **Do NOT call LLM** for complexity estimation (defeats purpose)
- If you need O(n²), justify with benchmarks proving <1ms impact

</rule>

<rule number="5" name="Benchmark Changes Require Verification">

After modifying `questions.json`, `runner.ts`, or routing logic:
```bash
cd examples/benchmarks && bun run runner.ts --dry-run
```

Then run at least 5 questions to verify no regression:
```bash
bun run runner.ts --limit=5 --full
```

</rule>

<rule number="6" name="Never Commit Secrets">

These patterns are forbidden in commits:
- `.env` files (except `.env.example`)
- API keys, tokens, credentials
- `LLM_API_KEY=...` in any file

</rule>

<rule number="7" name="Prompt Changes Need A/B Testing">

Before changing prompts in `src/think/prompts.ts`:
1. Run baseline benchmark: `bun run runner.ts --baseline-only --full`
2. Make change
3. Run tool benchmark: `bun run runner.ts --tool-only --full`
4. Compare accuracy delta — reject if >2% regression

</rule>

<rule number="8" name="Keep Responses Token-Light">

System prompts should be <30 tokens. User prompts should add minimal boilerplate.

```typescript
// BAD: 50+ tokens
"You are a helpful assistant that carefully analyzes problems step by step..."

// GOOD: <15 tokens
"Explain clearly. Use code if clearer."
```

</rule>

<rule number="9" name="Open-Ended Questions Use Judge-Only">

For explanatory/descriptive questions:
- Set `expected_answer: null` in questions.json
- Do NOT invent fake "correct" answers
- Evaluation is via `judge/index.ts`, not accuracy

</rule>

<rule number="10" name="One Responsibility Per Function">

Functions should do ONE thing:
- `extractAnswer()` — extracts answers
- `stripThinkingTags()` — strips tags
- `assessPromptComplexity()` — assesses complexity

If a function does multiple things, split it.

</rule>

<rule number="11" name="Respect Layer Boundaries">

Never import upward in the dependency graph:
- `infra/` must NOT import from `text/`, `domain/`, `think/`, etc.
- `text/` must NOT import from `domain/`, `compute/`, `think/`, etc.
- `think/` must NOT import from `tools/`

Violations create circular dependencies and break the build.

</rule>

</critical-rules>

</agent-guidelines>
