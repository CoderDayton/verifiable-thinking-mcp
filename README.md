<div align="center">

# Verifiable Thinking

**Your LLM is confidently wrong 40% of the time on reasoning questions.**<br>
**This fixes that.**

[![npm](https://img.shields.io/npm/v/verifiable-thinking-mcp?color=blue)](https://www.npmjs.com/package/verifiable-thinking-mcp)
[![CI](https://img.shields.io/github/actions/workflow/status/CoderDayton/verifiable-thinking-mcp/ci.yml?label=CI)](https://github.com/CoderDayton/verifiable-thinking-mcp/actions)
[![codecov](https://codecov.io/gh/CoderDayton/verifiable-thinking-mcp/branch/main/graph/badge.svg)](https://codecov.io/gh/CoderDayton/verifiable-thinking-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[Why This Exists](#why-this-exists) • [Quick Start](#quick-start) • [Features](#features) • [vs Sequential Thinking](#vs-sequential-thinking)

</div>

---

## The Problem

Ask Claude or GPT this:

> *A bat and ball cost $1.10. The bat costs $1 more than the ball. How much does the ball cost?*

**40% of the time, it answers $0.10.** Confidently. With reasoning. And it's wrong.

The correct answer is $0.05 (because $0.05 + $1.05 = $1.10).

This isn't a cherry-picked example. LLMs fail predictably on cognitive traps:
- Lily pad doubling problems
- Monty Hall scenarios  
- Base rate fallacies
- Gambler's fallacy questions

They fail because they pattern-match to *similar-looking* problems instead of reasoning through the actual structure.

## The Solution

```
┌─────────────────────────────────────────────────────────────────┐
│  "A bat and ball cost $1.10. The bat costs $1 more..."          │
│                              ↓                                  │
│  TRAP DETECTED: additive_system                                 │
│  ⚠️  Don't subtract $1 from $1.10. Set up: x + (x+1) = 1.10     │
│                              ↓                                  │
│  LLM receives warning BEFORE reasoning starts                   │
│                              ↓                                  │
│  Answer: $0.05 ✓                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Verifiable Thinking** detects 15 cognitive trap patterns in <1ms and warns the LLM before it starts reasoning. No extra LLM calls. Just pattern matching.

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

That's it. Claude now has trap detection built in.

## Why This Exists

I got tired of LLMs being confidently wrong.

Not wrong about obscure facts—wrong about basic math and logic. The kind of problems where a human who *thought carefully* would get it right, but an LLM pattern-matches to the wrong template and produces a confident, well-reasoned, incorrect answer.

The MCP ecosystem had "Sequential Thinking"—a tool that helps LLMs think step-by-step. But step-by-step reasoning doesn't help if you're reasoning toward the wrong answer from the start.

So I built this. **22,000+ lines of code. 1,831 tests. 15 trap detectors.** All to catch the patterns that make LLMs fail.

## Features

| Feature | What It Does | Why It Matters |
|---------|--------------|----------------|
| **Trap Detection** | 15 cognitive trap patterns detected in <1ms | Warns LLM *before* it reasons toward wrong answer |
| **Auto-Challenge** | Forces counterarguments when confidence >95% | Catches overconfident mistakes |
| **Contradiction Detection** | Spots "Let x=5" then "Now x=10" in reasoning chains | Prevents reasoning drift |
| **Confidence Tracking** | Monitors per-step and chain-average confidence | Flags suspiciously stable overconfidence |
| **Local Math** | Evaluates expressions without LLM calls | Catches arithmetic errors instantly |
| **Budget Control** | Token tracking with soft/hard limits | Prevents runaway reasoning chains |

<details>
<summary><strong>All 15 Trap Patterns</strong></summary>

| Pattern | Classic Example | The Trap |
|---------|-----------------|----------|
| `additive_system` | Bat and ball | Subtract instead of solve equations |
| `nonlinear_growth` | Lily pad doubling | Linear interpolation on exponential |
| `rate_pattern` | 5 machines, 5 minutes | Incorrect scaling |
| `harmonic_mean` | Round-trip average speed | Arithmetic mean for rates |
| `independence` | Coin flip sequence | Gambler's fallacy |
| `pigeonhole` | Socks in the dark | Underestimate worst case |
| `base_rate` | Medical test accuracy | Ignore prevalence |
| `factorial_counting` | Trailing zeros in n! | Simple division |
| `clock_overlap` | Hour/minute hand overlaps | Assume exactly 12 |
| `conditional_probability` | Given/if probability | Ignore conditioning |
| `conjunction_fallacy` | Linda the bank teller | More detail = more likely |
| `monty_hall` | Door switching game | 50/50 fallacy after reveal |
| `anchoring` | Estimation after priming | Irrelevant number influence |
| `sunk_cost` | Should I continue? | Past investment bias |
| `framing_effect` | "Save 200" vs "400 die" | Gain/loss framing |

</details>

## How It Works

```typescript
// Step 1: Start reasoning—trap detection runs automatically
scratchpad({
  operation: "step",
  question: "A bat and ball cost $1.10. The bat costs $1 more than the ball...",
  thought: "Let me work this out systematically",
  confidence: 0.8
})
// → Returns trap_analysis: { pattern: "additive_system", warning: "..." }

// Step 2: Continue reasoning with the warning in context
scratchpad({
  operation: "step", 
  thought: "Setting up equations: ball = x, bat = x + 1.00",
  confidence: 0.9
})

// Step 3: Complete—auto spot-check validates answer
scratchpad({
  operation: "complete",
  final_answer: "$0.05"
})
// → Returns validation result
```

## vs Sequential Thinking

| | Sequential Thinking | Verifiable Thinking |
|---|:---:|:---:|
| Trap detection | ❌ | 15 patterns |
| Auto-challenge | ❌ | ✓ |
| Contradiction detection | ❌ | ✓ |
| Confidence tracking | ❌ | ✓ |
| Local compute | ❌ | ✓ |
| Token budgets | ❌ | ✓ |
| Lines of code | ~100 | 22,000+ |
| Tests | ? | 1,831 |

Sequential Thinking helps you think step-by-step.<br>
Verifiable Thinking catches you when you're stepping in the wrong direction.

[Full comparison →](docs/competitive-analysis.md)

## API Reference

<details>
<summary><strong>scratchpad operations</strong></summary>

| Operation | Purpose |
|-----------|---------|
| `step` | Add reasoning step (trap priming on first) |
| `complete` | Finalize with auto spot-check |
| `revise` | Fix earlier step |
| `branch` | Explore alternative path |
| `challenge` | Force adversarial self-check |
| `navigate` | View history/branches |
| `spot_check` | Manual trap validation |
| `hint` | Progressive algebraic help |
| `mistakes` | Detect common errors |
| `augment` | Evaluate math expressions |
| `override` | Force-commit after failure |

</details>

<details>
<summary><strong>Session management</strong></summary>

- `list_sessions` — List all active sessions
- `get_session` — Get session details
- `clear_session` — Delete a session
- `compress` — CPC-style context compression

</details>

## Development

```bash
git clone https://github.com/CoderDayton/verifiable-thinking-mcp.git
cd verifiable-thinking-mcp && bun install

bun run dev      # MCP Inspector
bun test         # 1,831 tests
bun run build    # Production bundle
```

## License

MIT

---

<div align="center">

**[Report Bug](https://github.com/CoderDayton/verifiable-thinking-mcp/issues) · [Request Feature](https://github.com/CoderDayton/verifiable-thinking-mcp/issues) · [Discussions](https://github.com/CoderDayton/verifiable-thinking-mcp/discussions)**

*Built because LLMs shouldn't be confidently wrong.*

</div>
