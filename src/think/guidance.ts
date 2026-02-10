/**
 * Guidance Engine - Proactive reasoning assistance
 * Research-backed failure pattern detection and guidance generation
 */

import type { VerificationDomain } from "../domain/verification.ts";
import type { ThoughtRecord } from "../session/manager.ts";

// ============================================================================
// FAILURE PATTERNS - Research-backed reasoning hazards
// ============================================================================

export interface FailurePattern {
  trigger: RegExp;
  risk: string;
  guidance: string;
  checkpoint: boolean;
  minLength?: number;
}

export const FAILURE_PATTERNS: Record<string, FailurePattern> = {
  premature_conclusion: {
    // Only flag if "answer is/=:" appears in first 100 chars AND total response is long
    // (short responses are expected for structured phase outputs)
    trigger: /^.{0,100}answer\s*(is|=|:)/im,
    risk: "Concluding without showing intermediate steps",
    guidance: "Show your work before concluding",
    checkpoint: true,
    minLength: 200, // Don't flag short structured outputs - they're intentional
  },
  arithmetic_chain: {
    trigger: /\d+\s*[+\-*/]\s*\d+\s*[+\-*/]\s*\d+/,
    risk: "Arithmetic chain prone to carry-forward errors",
    guidance: "Verify each arithmetic step independently",
    checkpoint: true,
    minLength: 20,
  },
  short_answer: {
    // Only flag for long-form reasoning contexts, not structured phase outputs
    trigger: /^.{0,80}$/,
    risk: "Answer too brief - may lack reasoning",
    guidance: "Show intermediate steps",
    checkpoint: false,
    minLength: 0,
    // NOTE: This pattern is disabled when guidance=false (phase-based iteration)
    // It's designed for unstructured LLM outputs, not intentionally terse phases
  },
  contradiction: {
    trigger: /but\s+(also|then|wait)|however.*but|on\s+the\s+other\s+hand.*yet/i,
    risk: "Potential contradiction in reasoning",
    guidance: "Resolve conflicting statements before proceeding",
    checkpoint: true,
    minLength: 100,
  },
  overconfident_complex: {
    trigger: /obviously|clearly|trivially|of\s+course/i,
    risk: "Overconfidence may mask errors",
    guidance: "Verify 'obvious' steps explicitly",
    checkpoint: false,
    minLength: 100,
  },
  unchecked_assumption: {
    trigger: /let's\s+assume|assuming\s+that|suppose\s+that/i,
    risk: "Assumption may not hold",
    guidance: "Verify assumption is warranted by the problem",
    checkpoint: false,
    minLength: 100,
  },
};

// ============================================================================
// GUIDANCE ENGINE - Proactive reasoning assistance
// ============================================================================

export interface ThoughtAnalysis {
  patterns_detected: string[];
  guidance: string[];
  checkpoint_recommended: boolean;
  suggested_next: string | null;
  risk_level: "low" | "medium" | "high";
}

export function analyzeThought(
  thought: string,
  step: number,
  priorThoughts: ThoughtRecord[],
  domain: VerificationDomain,
): ThoughtAnalysis {
  const patterns_detected: string[] = [];
  const guidance: string[] = [];
  let checkpoint_recommended = false;
  let risk_score = 0;
  const thoughtLength = thought.length;

  // Check against known failure patterns
  for (const [name, pattern] of Object.entries(FAILURE_PATTERNS)) {
    const minLen = pattern.minLength ?? 0;
    if (thoughtLength >= minLen && pattern.trigger.test(thought)) {
      patterns_detected.push(name);
      guidance.push(pattern.guidance);
      if (pattern.checkpoint) checkpoint_recommended = true;
      risk_score++;
    }
  }

  // Domain-specific guidance
  if (step > 1) {
    if (domain === "math" && /=/.test(thought) && priorThoughts.length > 0) {
      if (guidance.length === 0) {
        guidance.push("Verify equation transformation preserves equality");
      }
    } else if (domain === "code" && /loop|iterate|recursive/i.test(thought)) {
      guidance.push("Verify termination condition exists");
      checkpoint_recommended = true;
      risk_score++;
    }
  }

  // Confidence trajectory analysis
  const confidences = priorThoughts
    .map((t) => t.verification?.confidence)
    .filter((c): c is number => c !== undefined);

  if (confidences.length >= 2) {
    const recent = confidences.slice(-2);
    const prev = recent[0] ?? 0;
    const curr = recent[1] ?? 0;
    if (curr < prev - 0.2) {
      guidance.push("Confidence dropping - consider revisiting assumptions");
      risk_score++;
    }
  }

  // Suggest next action
  let suggested_next: string | null = null;
  if (checkpoint_recommended) {
    suggested_next = "Pause and verify current step before proceeding";
  } else if (patterns_detected.includes("premature_conclusion")) {
    suggested_next = "Review all constraints before finalizing";
  } else if (step >= 3 && !priorThoughts.some((t) => t.verification?.passed)) {
    suggested_next = "Consider verifying intermediate steps";
  }

  const risk_level = risk_score >= 3 ? "high" : risk_score >= 1 ? "medium" : "low";

  return {
    patterns_detected,
    guidance: guidance.slice(0, 3),
    checkpoint_recommended,
    suggested_next,
    risk_level,
  };
}

// Simple heuristic domain detection for reasoning guidance.
// Intentionally simpler than domain/detection.ts — triggers on any math-like tokens
// rather than requiring dominant domain classification.
export function detectDomain(thought: string): VerificationDomain {
  if (/\d+\s*[+\-*/^=]\s*\d+|equation|solve|derivative|integral|sum\s+of/i.test(thought)) {
    return "math";
  }
  if (
    /function|class|return|const|let|var|def\s|import\s|async|await|=>|->|fn\s|impl\s/i.test(
      thought,
    )
  ) {
    return "code";
  }
  if (/if\s+.+\s+then|therefore|implies|hence|thus|conclude|premise|valid|invalid/i.test(thought)) {
    return "logic";
  }
  return "general";
}
