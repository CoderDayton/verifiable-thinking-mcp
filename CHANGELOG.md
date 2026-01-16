# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-01-15

### Added

- **Consistency Checking** - Automatic contradiction detection between reasoning steps
  - Detects value reassignment (e.g., "Let x = 5" then "Now x = 10")
  - Detects logical conflicts ("always" vs "never", "all" vs "none")
  - Detects sign flips (positive/negative, increasing/decreasing)
  - Runs every 3 steps via `runConsistencyCheck()` helper
  - O(n) algorithm, <100ms for 100 steps

- **Hypothesis Resolution** - Automatic detection of branch hypothesis outcomes
  - Detects confirmation signals (QED, "proven", "we have shown")
  - Detects refutation signals (contradiction, counterexample, "impossible")
  - Detects inconclusive signals ("need more evidence", "inconclusive")
  - Returns `hypothesis_resolution` field with outcome and suggestion

- **Auto-Challenge on Overconfidence** - Adversarial self-check triggers automatically
  - Triggers when confidence >95%
  - Triggers when confidence >90% with <3 steps and no verification
  - Returns `challenge_suggestion` field with challenge type recommendation
  - Uses `shouldChallenge()` from challenge module

- **Merge Suggestions** - Prompts to merge confirmed branch findings
  - When `hypothesis_resolution.outcome === "confirmed"`, suggests merging
  - Returns `merge_suggestion` field with merge recommendation

- **Build Command** - `bun run build` produces minified bundle
  - Output: `dist/index.js` (~2MB minified)
  - Externals: sury, effect, @valibot/to-json-schema

- **Competitive Analysis Documentation** - `docs/competitive-analysis.md`
  - Feature comparison vs `@modelcontextprotocol/server-sequential-thinking`
  - 20+ feature comparison table
  - Performance benchmarks

### Changed

- **Refactored `handleStep()`** - Reduced complexity from 104 to <50
  - Extracted `runConsistencyCheck()` helper
  - Extracted `runHypothesisResolution()` helper
  - Extracted `runAutoChallenge()` helper
  - Extracted `calculateSteppingGuidance()` helper
  - Extracted `runVerificationCheck()` helper

- **Updated test count** - 1831 tests (was 1496)

### Fixed

- Routing feedback analysis for trap pattern bypass scenarios

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

[Unreleased]: https://github.com/CoderDayton/verifiable-thinking-mcp/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/CoderDayton/verifiable-thinking-mcp/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/CoderDayton/verifiable-thinking-mcp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/CoderDayton/verifiable-thinking-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/CoderDayton/verifiable-thinking-mcp/releases/tag/v0.1.0
