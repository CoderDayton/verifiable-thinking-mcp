# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-02-09

### Added

- **Telegraphic Compression** - Word-level pruning for scratchpad thinking tokens
  - Strips articles (`a`, `an`, `the`), filler adverbs (`really`, `basically`, `actually`), and auxiliary verbs (`is`, `are`, `was`) while preserving reasoning connectives (`because`, `therefore`, `if`, `then`, `however`)
  - 70+ phrase replacements condensing verbose patterns (e.g., "in order to" → "to", "due to the fact that" → "because")
  - Protection patterns prevent damage to URLs, inline code, dates, versions, model IDs, file paths, slash-separated terms (A/B), numbers with units, markdown headers, and list markers
  - Applied after sentence selection — kept sentences get word-level compression on top of sentence-level filtering
  - New export: `telegraphicCompress(text: string): string`

- **Compression Benchmarks** - Two new benchmark suites
  - `test/compression-benchmark.ts` — 5 structured test cases with 27 pass/fail checks validating that key information survives and filler gets dropped
  - `test/compression-realworld.ts` — 3 long-form thinking scenarios (coding/fibonacci, math/probability, architecture analysis) with latency measurements
  - Average **49.1% token reduction** on real-world thinking text (37.8%–64.5% range)
  - Latency: 13–17ms per compression

### Changed

- **God-Optimized Compression Module** - `src/text/compression.ts` reduced from 1,707 → 1,158 lines (32% reduction) via 8 optimization passes while preserving all behavior
  - Removed dead code: `estimateTokens()` wrapper (inlined `estimateTokensFast` at all call sites), `computeNCDAsync()` and its `gzipAsync`/`promisify` imports, duplicate filler penalty in `relevanceScore()`
  - Collapsed `STOP_WORDS` (88 lines → 1 line) and `ABBREVIATIONS` (32 lines → 1 line) using `.split(" ")`
  - Extracted `makeSentenceMetadata()` factory replacing 3 identical object literals
  - Fused `tokenize()` and `tokenizeForTfIdf()` into `tokenize(text, filterStopWords?)` with backward-compatible alias
  - Converted `calculateAdaptiveRatio()` from 6-level if/else chain to lookup table
  - Cached entity sets on `SentenceMetadata` to avoid redundant `extractEntities()` calls
  - Reordered file sections for temporal coherence (types → text processing → scoring → selection → telegraphic → public API)
  - Renamed `hasCausalConnective` → `hasDependencyConnective` for accuracy

### Removed

- `computeNCDAsync()` — Async NCD variant was never called in the compression pipeline. Use `computeNCD()` (sync) instead.

### Performance

- **Telegraphic compression:** 49.1% average token reduction on real-world chain-of-thought text
- **Compression latency:** 13–17ms for 700–920 token inputs
- **Module size:** 32% fewer lines with identical behavior (1,967 tests passing)

## [0.5.0] - 2025-01-24

### Added

- **Real Token Counting with Tiktoken** - Replaced estimation-based counting with byte-pair encoding
  - Uses `o200k_base` encoding (GPT-4o, o1, o3-mini standard)
  - LRU cache with 10,000 entries and 30-minute TTL
  - **3,922× faster** on cache hits (95ms → 0.024ms)
  - Zero estimation error (previously 50-100% divergence)
  - Integrated `js-tiktoken` package with lazy initialization
  - Memory overhead: ~1.47 MB max (147 bytes/entry × 10k)

- **Compress on Input (Not Storage)** - Token savings applied before processing
  - Compression now happens in `handleStep()` before verification/compute
  - **Before:** Full thought → process → compress for storage
  - **After:** Compress thought → process compressed version
  - Saves tokens on LLM inference, not just session storage
  - Real-world impact: 10-step chain reduced from ~1,350 → ~580 tokens

- **Embedded Token Tracking** - Session-level token usage without indirection
  - Removed `WeakMap<Session, TokenUsage>` external tracking
  - Added `tokenUsage` field directly to `Session` interface:
    ```typescript
    tokenUsage: {
      input: number;    // Cumulative input tokens
      output: number;   // Cumulative output tokens
      operations: number; // Operation count
    }
    ```
  - **10-15% faster** token tracking (no pointer chasing)
  - Automatic cleanup with session expiry

- **Token Optimization Documentation** - Comprehensive architecture guide
  - Performance benchmarks (cache speedup, compression savings, memory footprint)
  - Real-world cost analysis ($4,193/year savings at 1k chains/day)
  - Configuration guide for different workload types
  - Trade-offs and edge case documentation
  - See `docs/token-optimization.md`

- **Batch Token Counting** - Efficient multi-string processing (v0.5.0)
  - `countTokensBatch()` processes cached/uncached strings separately
  - ~2× faster than individual calls for 100+ strings
  - Returns array of counts in same order as input
  - `countTokensBatchAsync()` with configurable yielding (default: every 10 items)

- **Async Token Counting API** - Non-blocking token operations (v0.5.0)
  - `countTokensAsync()` yields to event loop before encoding
  - `countTokensBatchAsync()` processes large batches without blocking
  - Ideal for large texts or high-concurrency scenarios
  - Same accuracy as synchronous versions

- **Adaptive Compression** - Context-aware target ratio tuning (v0.5.0)
  - Auto-calculates optimal `target_ratio` based on entropy + length
  - Low entropy (redundant) → aggressive (0.3-0.5)
  - High entropy (dense/code) → conservative (0.7-0.9)
  - Enabled by default, explicit `target_ratio` always takes precedence
  - See `calculateAdaptiveRatio()` in `src/text/compression.ts`

### Changed

- **Token Accounting Accuracy** - Compression now reflects actual input tokens
  - Uses tiktoken to calculate compressed thought tokens (not estimation)
  - Added `applied` field to `ThoughtRecord.compression` metadata
  - Token savings now accurately reported in session metadata

- **Test Suite Updates** - Token counting tests adapted for tiktoken behavior
  - Updated `test/tokens.test.ts` with real encoding expectations
  - All 1,836 tests passing with zero type errors

### Performance

- **Token counting:** 3,922× cache speedup (95ms uncached → 0.024ms cached)
- **Compression savings:** 56.8% token reduction (validated on 10-step chains)
- **Memory footprint:** 1.47 MB theoretical max (2.34 KB typical usage)
- **Token accuracy:** Zero estimation error (exact BPE token boundaries)

## [0.4.2] - 2026-01-15

### Fixed

- **npm publish now includes dist/** - Release workflow was missing `bun run build` step
  - Added build step before `npm publish` in CI
  - Added verification step to ensure `dist/index.js` exists
  - `npx -y verifiable-thinking-mcp` now works correctly

## [0.4.1] - 2026-01-15

### Fixed

- **npx compatibility** - Package now works with `npx -y verifiable-thinking-mcp`
  - Changed build target from `bun` to `node`
  - Added shebang (`#!/usr/bin/env node`) to built output
  - Changed `bin` and `main` to point to `dist/index.js`
  - Changed `files` to include `dist/**/*.js` instead of source TypeScript

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

[Unreleased]: https://github.com/CoderDayton/verifiable-thinking-mcp/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/CoderDayton/verifiable-thinking-mcp/compare/v0.5.0...v0.6.0
[0.4.2]: https://github.com/CoderDayton/verifiable-thinking-mcp/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/CoderDayton/verifiable-thinking-mcp/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/CoderDayton/verifiable-thinking-mcp/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/CoderDayton/verifiable-thinking-mcp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/CoderDayton/verifiable-thinking-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/CoderDayton/verifiable-thinking-mcp/releases/tag/v0.1.0
