# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-01-11

### Added

- **Confidence Drift Detection (CDD)** - Novel meta-signal analyzing confidence trajectory for reasoning quality
  - Detects patterns: stable, stable_overconfident, declining, improving, v_shaped, oscillating, cliff
  - Flags `unresolved=true` when V-shaped pattern exists without revision step
  - **Stable overconfident detection** - Flags chains where all confidence ≥0.85 with low variance (often wrong on trap questions)
  - O(n) single-pass algorithm, <1ms execution
  - Integrated into `complete()` operation with `confidence_drift` response field
  - **Step-level warnings** - CDD now runs during `step` operation (at step 3+) for early drift detection
  - 100% precision (no false positives), improved recall with stable_overconfident pattern
  - Benchmark: `examples/benchmarks/cdd-bench.ts`

- **Hard budget limit** - `hard_limit_tokens` parameter blocks operations when session tokens exceed threshold
  - Returns `status: "budget_exhausted"` with recommendation to complete or start new session
  - Check happens BEFORE processing operation, preventing wasted compute

## [0.2.0] - 2026-01-11

### Added

- **Token usage tracking** - All tool responses now include token usage metadata
  - `tokens`: input/output/total for current operation
  - `session_tokens`: cumulative usage across the session
  - Model-aware estimation (Claude, GPT, Llama, Mistral, etc.)
- **Cost control** - `warn_at_tokens` parameter alerts when session token usage exceeds threshold

### Fixed

- Error responses now correctly track session token usage for accurate budget monitoring

## [0.1.0] - 2026-01-11

### Added

- **Scratchpad tool** - Unified reasoning scratchpad with auto-step tracking, confidence monitoring, and verification-gated flow
  - Operations: `step`, `navigate`, `branch`, `revise`, `complete`, `augment`, `override`, `hint`, `mistakes`, `spot_check`
  - Auto-verification for chains >3 steps
  - Confidence tracking with configurable threshold
  - Session management with TTL cleanup

- **Cognitive trap detection** - 15 structural trap patterns detected in <1ms
  - Additive systems (bat-ball problem)
  - Exponential growth (lily pad doubling)
  - Rate problems (relative speed)
  - Harmonic mean (average speed traps)
  - Independence (probability)
  - Pigeonhole principle
  - Base rate fallacy
  - Factorial counting
  - Clock overlap problems
  - Conditional probability
  - Conjunction fallacy
  - Monty Hall problem
  - Anchoring bias
  - Sunk cost fallacy
  - Framing effect

- **Trap priming** - Pass `question=` on first step to prime against detected traps before reasoning begins

- **Auto spot-check** - Questions stored in session are automatically spot-checked at `complete` operation

- **Context compression** - CPC-style sentence-level relevance scoring with TF-IDF + NCD

- **Local compute** - Math expression evaluation, derivation, and simplification

- **Session tools** - List, get, and clear reasoning sessions

### Security

- `MAX_QUESTION_LENGTH=10_000` prevents memory exhaustion
- First-write-wins for `setQuestion()` prevents session hijacking
- OIDC trusted publishing for npm (no tokens stored)

[Unreleased]: https://github.com/CoderDayton/verifiable-thinking-mcp/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/CoderDayton/verifiable-thinking-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/CoderDayton/verifiable-thinking-mcp/releases/tag/v0.1.0
