# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/CoderDayton/verifiable-thinking-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/CoderDayton/verifiable-thinking-mcp/releases/tag/v0.1.0
