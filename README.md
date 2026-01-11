# Verifiable Thinking MCP

> LLMs fail predictably on cognitive traps—bat-and-ball, lily pad, Monty Hall. This MCP server catches those mistakes *before* the final answer.

An MCP server for structured reasoning with trap detection, verification, and context compression.

## Quick Stats

| Metric | Value |
|--------|-------|
| Cognitive trap patterns | 15 structural detectors |
| Detection latency | <1ms (O(n) single-pass) |
| Test coverage | 1496+ tests, 100% line threshold |
| Dependencies | 3 runtime (fastmcp, zod, dotenv) |

## Features

- **Trap Detection** — Catches 15 cognitive trap patterns (additive systems, exponential growth, Monty Hall, base rate neglect, etc.) using structural heuristics, no LLM calls
- **Scratchpad** — Structured reasoning with auto step tracking, confidence monitoring, and verification gates
- **Local Compute** — Math expression evaluation without LLM round-trips
- **CPC Compression** — Sentence-level context compression with query-aware relevance scoring

## Quick Start

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "verifiable-thinking": {
      "command": "npx",
      "args": ["-y", "verifiable-thinking-mcp"]
    }
  }
}
```

Or with Bun:

```json
{
  "mcpServers": {
    "verifiable-thinking": {
      "command": "bunx",
      "args": ["verifiable-thinking-mcp"]
    }
  }
}
```

### Basic Usage

```typescript
// Step 1: Start reasoning with trap priming
scratchpad({
  operation: "step",
  question: "A bat and ball cost $1.10. The bat costs $1 more than the ball. How much does the ball cost?",
  thought: "Let me set up equations. Let ball = x, bat = x + 1.00",
  confidence: 0.9
})
// Returns trap_analysis warning about additive_system pattern

// Step 2: Continue reasoning
scratchpad({
  operation: "step",
  thought: "x + (x + 1.00) = 1.10, so 2x = 0.10, x = 0.05",
  confidence: 0.95
})

// Step 3: Complete with spot-check
scratchpad({
  operation: "complete",
  final_answer: "$0.05"
})
// Auto spot-checks against stored question
```

## Tools

### `scratchpad` (primary)

Unified reasoning tool with operation-based dispatch.

**Operations:**

| Operation | Purpose | Required Params |
|-----------|---------|-----------------|
| `step` | Add reasoning step | `thought` |
| `complete` | Finalize chain | — |
| `revise` | Fix earlier step | `thought`, `target_step` |
| `branch` | Alternative path | `thought` |
| `navigate` | View history | `view` (history\|branches\|step\|path) |
| `spot_check` | Manual trap check | `question`, `answer` |
| `hint` | Progressive simplification | `expression` |
| `mistakes` | Algebraic error detection | `text` |
| `augment` | Compute math expressions | `text` |
| `override` | Force-commit failed step | `failed_step`, `reason` |

**Key Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `question` | string | Pass on first step for trap priming |
| `thought` | string | Current reasoning step |
| `confidence` | 0-1 | Step confidence (accumulates to chain average) |
| `verify` | boolean | Enable domain verification (auto-enabled after step 3) |
| `domain` | enum | math, logic, code, general |

**Workflow:**

1. `step(question="...", thought="...")` → trap_analysis if patterns detected
2. Continue with `step(thought="...")` → auto-verify kicks in after step 3
3. If verification fails → `revise` or `branch`
4. `complete(final_answer="...")` → auto spot-check against stored question
5. If status="review" → follow `reconsideration.suggested_revise`

### `list_sessions`

List all active reasoning sessions.

### `get_session`

Retrieve session in `full`, `summary`, or `compressed` format.

### `clear_session`

Clear specific session or all sessions.

### `compress`

Standalone CPC-style context compression.

```typescript
compress({
  context: "Long text to compress...",
  query: "relevance query",
  target_ratio: 0.5,
  boost_reasoning: true
})
```

## Trap Detection

Detects 15 structural patterns without LLM calls:

| Pattern | Trap | Example |
|---------|------|---------|
| `additive_system` | Subtract instead of solve | bat-ball, widget-gadget |
| `nonlinear_growth` | Linear interpolation | lily pad doubling |
| `rate_pattern` | Incorrect scaling | 5 machines/5 minutes |
| `harmonic_mean` | Arithmetic mean for rates | average speed round-trip |
| `independence` | Gambler's fallacy | coin flip sequences |
| `pigeonhole` | Underestimate worst case | minimum to guarantee |
| `base_rate` | Ignore prevalence | medical test accuracy |
| `factorial_counting` | Simple division | trailing zeros in n! |
| `clock_overlap` | Assume 12 overlaps | hour/minute hand |
| `conditional_probability` | Ignore conditioning | given/if probability |
| `conjunction_fallacy` | More detail = more likely | Linda problem |
| `monty_hall` | 50/50 after reveal | door switching |
| `anchoring` | Influenced by irrelevant number | estimation after priming |
| `sunk_cost` | Consider past investment | should continue? |
| `framing_effect` | Gain/loss framing bias | save vs die |

## Architecture

```
src/
├── index.ts              # FastMCP server entry
├── tools/
│   ├── scratchpad.ts     # Main reasoning tool (1800 LOC)
│   ├── sessions.ts       # Session management
│   └── compress.ts       # Compression tool
└── lib/
    ├── think/
    │   ├── spot-check.ts # Trap detection (O(n))
    │   ├── guidance.ts   # Domain detection
    │   └── scratchpad-schema.ts
    ├── compression.ts    # CPC-style compression
    ├── compute/          # Local math evaluation
    ├── verification.ts   # Domain verifiers
    ├── session.ts        # Session manager with TTL
    └── extraction.ts     # Answer extraction
```

## Development

```bash
# Clone and install
git clone <repo-url>
cd verifiable-thinking
bun install

# Interactive dev mode with MCP Inspector
bun run dev

# Inspect server capabilities
bun run inspect

# Run tests
bun test

# Type check
bun run typecheck

# Lint and format
bun run check
```

## Benchmarks

See `examples/benchmarks/`:

| Benchmark | Purpose |
|-----------|---------|
| `priming-latency.ts` | Validates O(n) trap detection (<1ms) |
| `priming-bench.ts` | LLM accuracy with/without priming |
| `math-bench.ts` | Local compute accuracy |
| `compression-bench.ts` | Compression ratio and retention |

Run benchmarks:

```bash
cd examples/benchmarks
bun run priming-latency.ts
bun run priming-bench.ts --full
```

## License

MIT
