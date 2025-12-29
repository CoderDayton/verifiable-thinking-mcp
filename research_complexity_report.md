# Verifiable Thinking MCP: Complexity & Step System Analysis

## Architecture Overview

The "thinking" process is orchestrated by the **client** (in this case, `examples/benchmarks/runner.ts`), not the MCP server itself. The MCP server (`src/tools/think.ts`) is a passive state manager and guidance engine.

1.  **Driver**: `runner.ts` executes the loop (`runWithTool`).
2.  **State & Guidance**: `think.ts` records steps and calls `guidance.ts` to analyze them.
3.  **Decision**: `runner.ts` decides whether to continue based on the `risk_level` returned by `think.ts`.

## Step Decision Flow

The decision to stop or continue happens explicitly in `examples/benchmarks/runner.ts` (lines 596-627):

1.  **Step 1**: Runner asks LLM for initial reasoning.
2.  **Analysis**: Runner sends thought to MCP (`thinkTool`).
3.  **Risk Check**: MCP returns `risk_level` (low/medium/high) and `patterns`.
4.  **The Gate**:
    ```typescript
    // runner.ts:596
    const needsDeeper =
      riskLevel !== "low" ||
      hasCheckpoint ||
      patterns.some((p) =>
        ["premature_conclusion", "arithmetic_chain", "overconfident"].includes(
          p
        )
      );
    ```
5.  **Early Termination**: If `needsDeeper` is `false`, the runner **aborts** the speculative verification and returns the Step 1 answer immediately.

**Why 97/101 questions use 1 step:**
The system defaults to "Low Risk" (Stop) unless a specific _failure pattern_ is detected. It does **not** assess problem complexity. If the LLM gives a clean-looking wrong answer that doesn't trigger a regex (e.g., no "obviously", no long arithmetic chain), the system assumes it's correct and stops.

## Problems Identified

1.  **"Guilty until proven innocent" Logic**: The system assumes an answer is good unless it finds a specific error pattern. It lacks a "Complexity Classifier" to force multi-step reasoning for hard problems regardless of the answer's appearance.
2.  **Strict Regex Triggers**: The failure patterns in `src/lib/think/guidance.ts` are specific and easy to bypass:
    - `arithmetic_chain`: Requires **3+ operators** (`\d ... \d ... \d ... \d`). Simple but wrong math (e.g., `12 * 13 = 146`) won't trigger it.
    - `premature_conclusion`: Requires transition words (`therefore`, `thus`) _before_ "answer is". A simple "The answer is X" bypasses it.
    - `overconfident_complex`: Only triggers if length > 200 chars.
3.  **No Feedback Loop**: The runner decides to stop _before_ seeing if the verification step would have found an error. It cancels the verification request to save tokens.

## Relevant Code Snippets

**1. The "One Step" Decision (runner.ts)**

```typescript
// src/examples/benchmarks/runner.ts:599
if (!needsDeeper) {
  // Low risk - trust initial attempt WITHOUT extra MCP round-trip
  // CANCEL SPECULATIVE VERIFICATION
  abortController.abort();
  return { ... }; // Returns after Step 1
}
```

**2. The Risk Calculation (guidance.ts)**

```typescript
// src/lib/think/guidance.ts:146
const risk_level =
  risk_score >= 3 ? "high" : risk_score >= 1 ? "medium" : "low";
// risk_score only increases if a regex matches
```

**3. The Missing Complexity Check**
There is no code that checks `question.difficulty` or analyzes the question text to set a minimum step count. `estimated_total` is passed as `2` but ignored if risk is low.

## Recommendations

1.  **Implement Complexity Classification**:

    - Add a `classifyComplexity(question)` function in `src/lib/think/guidance.ts`.
    - If complexity is "hard", force `risk_level = "medium"` (at least) to trigger verification.

2.  **Loosen Failure Patterns**:

    - Update `premature_conclusion` to catch short answers without reasoning, even without "therefore".
    - Lower `arithmetic_chain` to 2 operators.

3.  **Force Verification for "SOTA/Hard"**:

    - In `runner.ts`, override `needsDeeper = true` if the benchmark difficulty is known to be high, or if the question contains keywords like "prove", "derive", "chain".

4.  **Self-Correction Loop**:
    - Instead of aborting verification immediately, allow a "light" verification step (e.g., "Rate confidence 0-1") and continue if confidence < 0.9.
