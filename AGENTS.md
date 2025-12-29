# Agent Guidelines for Verifiable Thinking

## Code Organization

### Shared Utilities Belong in `src/lib/`

**Do NOT put reusable functionality in benchmark runners or test files.**

Utilities that could be used by both the main tool AND benchmarks/tests should live in `src/lib/`:

- `src/lib/extraction.ts` - Answer extraction, markdown stripping
- `src/lib/verification.ts` - Domain-specific verifiers
- `src/lib/compression.ts` - CPC-style compression
- `src/lib/compute/` - Local compute helpers (math solvers)
- `src/lib/cache.ts` - Caching utilities
- `src/lib/think/complexity.ts` - Local complexity assessment

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

- **Low** → execute only (1 phase)
- **Moderate** → execute + verify (2 phases)
- **High** → identify + execute + verify (3 phases)
- **Very Hard / Almost Impossible** → full pipeline (4 phases)

This replaces LLM-based budget estimation, saving ~500ms per question.
