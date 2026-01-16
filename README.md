<div align="center">

<img src="assets/header.svg" alt="Verifiable Thinking MCP" width="800" />

**Your LLM is confidently wrong 40% of the time on reasoning questions. This fixes that.**

[![npm version](https://img.shields.io/npm/v/verifiable-thinking-mcp?color=blue&label=npm)](https://www.npmjs.com/package/verifiable-thinking-mcp)
[![CI](https://img.shields.io/github/actions/workflow/status/CoderDayton/verifiable-thinking-mcp/ci.yml?label=CI)](https://github.com/CoderDayton/verifiable-thinking-mcp/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/CoderDayton/verifiable-thinking-mcp/branch/main/graph/badge.svg)](https://codecov.io/gh/CoderDayton/verifiable-thinking-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

*15 trap patterns detected in <1ms. No LLM calls. Just pattern matching.*

[Quick Start](#quick-start) • [Features](#features) • [Trap Detection](#trap-detection) • [API](#tools)

</div>

---

```
┌────────────────────────────────────────────────────────────────┐
│ "A bat and ball cost $1.10. The bat costs $1 more..."          │
│                             ↓                                  │
│ TRAP DETECTED: additive_system                                 │
│ > Don't subtract $1 from $1.10. Set up: x + (x+1) = 1.10       │
│                             ↓                                  │
│ Answer: $0.05 (not $0.10)                                      │
└────────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
npx -y verifiable-thinking-mcp
```

Add to Claude Desktop (`claude_desktop_config.json`):

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

## Features

| | |
|---|---|
| 🎯 **Trap Detection** | 15 patterns (bat-ball, Monty Hall, base rate) caught before reasoning starts |
| ⚔️ **Auto-Challenge** | Forces counterarguments when confidence >95%—no more overconfident wrong answers |
| 🔍 **Contradiction Detection** | Catches "Let x=5" then "Now x=10" across steps |
| 🌿 **Hypothesis Branching** | Explore alternatives, auto-detects when branches confirm/refute |
| 🔢 **Local Math** | Evaluates expressions without LLM round-trips |
| 🗜️ **Compression** | Query-aware context compression for long chains |

## How It Works

```typescript
// Start with a question—trap detection runs automatically
scratchpad({
  operation: "step",
  question: "A bat and ball cost $1.10...",
  thought: "Let ball = x, bat = x + 1.00",
  confidence: 0.9
})
// → Returns trap_analysis warning

// High confidence? Auto-challenge kicks in
scratchpad({ operation: "step", thought: "...", confidence: 0.96 })
// → Returns challenge_suggestion: "What if your assumption is wrong?"

// Complete with spot-check
scratchpad({ operation: "complete", final_answer: "$0.05" })
```

## Trap Detection

| Pattern | What It Catches |
|---------|-----------------|
| `additive_system` | Bat-ball, widget-gadget (subtract instead of solve) |
| `nonlinear_growth` | Lily pad doubling (linear interpolation) |
| `monty_hall` | Door switching (50/50 fallacy) |
| `base_rate` | Medical tests (ignoring prevalence) |
| `independence` | Coin flips (gambler's fallacy) |

<details>
<summary>All 15 patterns</summary>

| Pattern | Trap |
|---------|------|
| `additive_system` | Subtract instead of solve |
| `nonlinear_growth` | Linear interpolation |
| `rate_pattern` | Incorrect scaling |
| `harmonic_mean` | Arithmetic mean for rates |
| `independence` | Gambler's fallacy |
| `pigeonhole` | Underestimate worst case |
| `base_rate` | Ignore prevalence |
| `factorial_counting` | Simple division |
| `clock_overlap` | Assume 12 overlaps |
| `conditional_probability` | Ignore conditioning |
| `conjunction_fallacy` | More detail = more likely |
| `monty_hall` | 50/50 after reveal |
| `anchoring` | Irrelevant number influence |
| `sunk_cost` | Past investment bias |
| `framing_effect` | Gain/loss framing |

</details>

## Tools

**`scratchpad`** — the main tool with 11 operations:

| Operation | What It Does |
|-----------|--------------|
| `step` | Add reasoning step (trap priming on first) |
| `complete` | Finalize with auto spot-check |
| `revise` | Fix earlier step |
| `branch` | Explore alternative path |
| `challenge` | Force adversarial self-check |
| `navigate` | View history/branches |

<details>
<summary>All operations</summary>

| Operation | Purpose |
|-----------|---------|
| `step` | Add reasoning step |
| `complete` | Finalize chain |
| `revise` | Fix earlier step |
| `branch` | Alternative path |
| `challenge` | Adversarial self-check |
| `navigate` | View history |
| `spot_check` | Manual trap check |
| `hint` | Progressive simplification |
| `mistakes` | Algebraic error detection |
| `augment` | Compute math expressions |
| `override` | Force-commit failed step |

</details>

**Other tools:** `list_sessions`, `get_session`, `clear_session`, `compress`

## vs Sequential Thinking MCP

| | Sequential Thinking | Verifiable Thinking |
|---|---|---|
| Trap detection | ❌ | 15 patterns |
| Auto-challenge | ❌ | >95% confidence |
| Contradiction detection | ❌ | ✅ |
| Confidence tracking | ❌ | Per-step + chain |
| Local compute | ❌ | ✅ |
| Token budgets | ❌ | Soft + hard limits |

Sequential Thinking is ~100 lines. This is 22,000+ with 1,831 tests.

See [`docs/competitive-analysis.md`](docs/competitive-analysis.md) for full breakdown.

## Development

```bash
git clone https://github.com/CoderDayton/verifiable-thinking-mcp.git
cd verifiable-thinking-mcp && bun install
bun run dev      # Interactive MCP Inspector
bun test         # 1,831 tests
```

## License

MIT

---

<div align="center">

**[Report Bug](https://github.com/CoderDayton/verifiable-thinking-mcp/issues) · [Request Feature](https://github.com/CoderDayton/verifiable-thinking-mcp/issues)**

</div>
