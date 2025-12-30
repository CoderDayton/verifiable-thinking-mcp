# Agent Guidelines for Verifiable Thinking

## Code Organization

### Shared Utilities Belong in `src/lib/`

**Do NOT put reusable functionality in benchmark runners or test files.**

Utilities that could be used by both the main tool AND benchmarks/tests should live in `src/lib/`:

- `src/lib/extraction.ts` - Answer extraction, markdown stripping, thinking tag removal
- `src/lib/verification.ts` - Domain-specific verifiers
- `src/lib/compression.ts` - CPC-style compression
- `src/lib/compute/` - Local compute helpers (math solvers)
- `src/lib/cache.ts` - Caching utilities
- `src/lib/think/complexity.ts` - Local complexity assessment
- `src/lib/think/route.ts` - Question routing (complexity-based path selection)
- `src/lib/think/prompts.ts` - Domain-aware prompt templates
- `src/lib/domain.ts` - Unified domain detection

The benchmark runner (`examples/benchmarks/runner.ts`) should IMPORT from `src/lib/`, not duplicate logic.

### Why This Matters

1. **Single source of truth** - Fixes apply everywhere
2. **Testable** - Shared code gets unit tested in `test/`
3. **The tool uses it** - If logic is in the runner, the actual MCP tool can't use it

### Pattern

```typescript
// BAD: Duplicating in runner.ts
function extractAnswer(response: string): string {
  // ... 50 lines of logic that should be shared
}

// GOOD: Import from lib
import { extractAnswer } from "../../src/lib/extraction.ts";
```

## Tool Architecture

### MCP Tools in `src/tools/`

Each tool should be self-contained and use shared libraries:

- `think.ts` - Structured reasoning with guidance
- `sessions.ts` - Session management
- `compress.ts` - Text compression

### New Features Go in Tools First

When adding new capabilities:

1. **Add shared logic to `src/lib/`** - The reusable algorithm/detection
2. **Add tool in `src/tools/`** - Expose via MCP for LLM to call
3. **Update benchmarks to use the tool** - Not duplicate the logic

Example: Complexity assessment
```typescript
// src/lib/think/complexity.ts - The algorithm
export function assessPromptComplexity(text: string): ComplexityResult { ... }

// src/tools/think.ts - Exposed via tool response
// The think tool can include complexity metadata in its response

// examples/benchmarks/runner.ts - Uses the lib
import { estimateBudgetLocal } from "../../src/lib/think/complexity";
```

## Complexity-Based Routing

The `src/lib/think/complexity.ts` module provides O(n) complexity assessment:

- **Low** → direct answer (1 LLM call)
- **Moderate** → reasoning prompt (1 LLM call)
- **High** → reasoning + spot-check for trap patterns (1-2 LLM calls)
- **Very Hard / Almost Impossible** → reasoning + spot-check (2 LLM calls)

This replaces LLM-based budget estimation, saving ~500ms per question.

## Explanatory Questions

Questions starting with "explain", "describe", "compare" are detected as explanatory:

- **Skip verification** - spot-check hurts open-ended quality
- **Domain-aware prompts** - `src/lib/think/prompts.ts` provides domain-specific steering
- **No expected answer** - use `expected_answer: null` in questions.json for judge-only evaluation

## Response Processing

The `src/lib/extraction.ts` module handles:

- **Thinking tag removal** - strips `<think>...</think>` tags from model responses
- **Answer extraction** - priority-based pattern matching for structured answers
- **Markdown stripping** - cleans formatting for comparison

## Benchmark Configuration

The benchmark runner loads `.env` from project root via dotenv. Key variables:

- `LLM_MODEL` - Model name for API calls
- `LLM_BASE_URL` - API endpoint
- `LLM_API_KEY` - Authentication

Note: `examples/benchmarks/.env` overrides root `.env` if present (Bun loads from cwd first).

---

## ⚠️ Critical Rules (MUST FOLLOW)

### 1. Never Duplicate Logic

If you write a function that could be reused:
- **STOP** - check if it exists in `src/lib/`
- If it doesn't exist, **add it there first**
- Import it everywhere else

Violations create drift where fixes don't propagate.

### 2. Tests Are Non-Negotiable

Before any PR:
```bash
bun test --timeout 60000
```

- **All 564+ tests must pass**
- New features require new tests in `test/`
- Test file naming: `<module>.test.ts`

### 3. Type Safety Is Required

```bash
bunx tsc --noEmit
```

- **Zero type errors allowed**
- No `any` without explicit justification comment
- Use `as` casts sparingly and only after null checks

### 4. Preserve O(n) Complexity

The routing and domain detection are intentionally O(n) single-pass:
- **Do NOT add nested loops** to `complexity.ts`, `domain.ts`, or `route.ts`
- **Do NOT call LLM** for complexity estimation (defeats purpose)
- If you need O(n²), justify with benchmarks proving <1ms impact

### 5. Benchmark Changes Require Verification

After modifying `questions.json`, `runner.ts`, or routing logic:
```bash
cd examples/benchmarks && bun run runner.ts --dry-run
```

Then run at least 5 questions to verify no regression:
```bash
bun run runner.ts --limit=5 --full
```

### 6. Never Commit Secrets

These patterns are forbidden in commits:
- `.env` files (except `.env.example`)
- API keys, tokens, credentials
- `LLM_API_KEY=...` in any file

### 7. Prompt Changes Need A/B Testing

Before changing prompts in `src/lib/think/prompts.ts`:
1. Run baseline benchmark: `bun run runner.ts --baseline-only --full`
2. Make change
3. Run tool benchmark: `bun run runner.ts --tool-only --full`
4. Compare accuracy delta - reject if >2% regression

### 8. Keep Responses Token-Light

System prompts should be <30 tokens. User prompts should add minimal boilerplate.

```typescript
// BAD: 50+ tokens
"You are a helpful assistant that carefully analyzes problems step by step..."

// GOOD: <15 tokens
"Explain clearly. Use code if clearer."
```

### 9. Open-Ended Questions Use Judge-Only

For explanatory/descriptive questions:
- Set `expected_answer: null` in questions.json
- Do NOT invent fake "correct" answers
- Evaluation is via `judge.ts`, not accuracy

### 10. One Responsibility Per Function

Functions in `src/lib/` should do ONE thing:
- `extractAnswer()` - extracts answers
- `stripThinkingTags()` - strips tags
- `assessPromptComplexity()` - assesses complexity

If a function does multiple things, split it.
