/**
 * Confidence Drift Detection (CDD) Integration Tests
 *
 * Tests CDD integration with the scratchpad tool's complete() operation.
 * Verifies that V-shaped confidence patterns trigger unresolved warnings.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SessionManager, type ThoughtRecord } from "../src/lib/session";
import { analyzeConfidenceDrift } from "../src/lib/think/confidence-drift";

// ============================================================================
// HELPERS
// ============================================================================

function createSession(): string {
  const sessionId = `test-cdd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return sessionId;
}

function addThoughtWithConfidence(
  sessionId: string,
  stepNumber: number,
  confidence: number,
  options?: { revisesStep?: number },
): void {
  const record: ThoughtRecord = {
    id: `${sessionId}:main:${stepNumber}`,
    step_number: stepNumber,
    thought: `Step ${stepNumber} reasoning`,
    timestamp: Date.now(),
    branch_id: "main",
    verification: {
      passed: true,
      confidence,
      domain: "math",
    },
    revises_step: options?.revisesStep,
  };
  SessionManager.addThought(sessionId, record);
}

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe("CDD Integration with SessionManager", () => {
  let sessionId: string;

  beforeEach(() => {
    sessionId = createSession();
  });

  afterEach(() => {
    SessionManager.clear(sessionId);
  });

  test("detects V-shaped pattern from real session thoughts", () => {
    // Simulate a reasoning session with V-shaped confidence
    // Step 1: Initial analysis - confident
    addThoughtWithConfidence(sessionId, 1, 0.9);
    // Step 2: Hit difficulty - confidence drops
    addThoughtWithConfidence(sessionId, 2, 0.5);
    // Step 3: Recovery without revision - confidence back up
    addThoughtWithConfidence(sessionId, 3, 0.85);

    // Get thoughts from session
    const thoughts = SessionManager.getThoughts(sessionId);
    expect(thoughts.length).toBe(3);

    // Analyze drift
    const drift = analyzeConfidenceDrift(thoughts);

    expect(drift.pattern).toBe("v_shaped");
    expect(drift.unresolved).toBe(true);
    expect(drift.min_step).toBe(2);
    expect(drift.max_drop).toBeGreaterThanOrEqual(0.35);
    expect(drift.recovery).toBeGreaterThanOrEqual(0.35);
    expect(drift.has_revision_after_drop).toBe(false);
    expect(drift.suggestion).not.toBeNull();
  });

  test("V-shaped pattern with revision is NOT unresolved", () => {
    // Step 1: Initial - confident
    addThoughtWithConfidence(sessionId, 1, 0.9);
    // Step 2: Hit difficulty - drops
    addThoughtWithConfidence(sessionId, 2, 0.5);
    // Step 3: Revision addresses uncertainty - recovery with revision marker
    addThoughtWithConfidence(sessionId, 3, 0.85, { revisesStep: 2 });

    const thoughts = SessionManager.getThoughts(sessionId);
    const drift = analyzeConfidenceDrift(thoughts);

    expect(drift.pattern).toBe("v_shaped");
    expect(drift.unresolved).toBe(false); // Resolved because revision exists
    expect(drift.has_revision_after_drop).toBe(true);
    expect(drift.suggestion).toBeNull();
  });

  test("stable confidence pattern produces no warning", () => {
    addThoughtWithConfidence(sessionId, 1, 0.8);
    addThoughtWithConfidence(sessionId, 2, 0.82);
    addThoughtWithConfidence(sessionId, 3, 0.79);
    addThoughtWithConfidence(sessionId, 4, 0.81);

    const thoughts = SessionManager.getThoughts(sessionId);
    const drift = analyzeConfidenceDrift(thoughts);

    expect(drift.pattern).toBe("stable");
    expect(drift.unresolved).toBe(false);
    expect(drift.drift_score).toBeLessThan(0.1);
  });

  test("declining confidence triggers review but not unresolved", () => {
    addThoughtWithConfidence(sessionId, 1, 0.9);
    addThoughtWithConfidence(sessionId, 2, 0.75);
    addThoughtWithConfidence(sessionId, 3, 0.6);
    addThoughtWithConfidence(sessionId, 4, 0.45);

    const thoughts = SessionManager.getThoughts(sessionId);
    const drift = analyzeConfidenceDrift(thoughts);

    expect(drift.pattern).toBe("declining");
    expect(drift.unresolved).toBe(false);
  });

  test("cliff pattern at end (late error detection)", () => {
    addThoughtWithConfidence(sessionId, 1, 0.9);
    addThoughtWithConfidence(sessionId, 2, 0.88);
    addThoughtWithConfidence(sessionId, 3, 0.85);
    addThoughtWithConfidence(sessionId, 4, 0.3); // Sudden drop

    const thoughts = SessionManager.getThoughts(sessionId);
    const drift = analyzeConfidenceDrift(thoughts);

    expect(drift.pattern).toBe("cliff");
    expect(drift.unresolved).toBe(false);
    expect(drift.min_step).toBe(4);
  });

  test("insufficient steps returns insufficient pattern", () => {
    addThoughtWithConfidence(sessionId, 1, 0.9);
    addThoughtWithConfidence(sessionId, 2, 0.5);

    const thoughts = SessionManager.getThoughts(sessionId);
    const drift = analyzeConfidenceDrift(thoughts);

    expect(drift.pattern).toBe("insufficient");
    expect(drift.unresolved).toBe(false);
  });
});

describe("CDD Real-World Trap Scenarios", () => {
  let sessionId: string;

  beforeEach(() => {
    sessionId = createSession();
  });

  afterEach(() => {
    SessionManager.clear(sessionId);
  });

  test("bat-ball trap: confident → doubt → wrong intuitive answer", () => {
    // Simulates reasoning on "A bat and ball cost $1.10..."
    // Model starts confident, sees the numbers, doubts, then picks intuitive answer
    addThoughtWithConfidence(sessionId, 1, 0.85); // "This looks straightforward"
    addThoughtWithConfidence(sessionId, 2, 0.7); // "Wait, let me check..."
    addThoughtWithConfidence(sessionId, 3, 0.5); // "Hmm, this is tricky"
    addThoughtWithConfidence(sessionId, 4, 0.65); // "I think I see it"
    addThoughtWithConfidence(sessionId, 5, 0.8); // "The ball costs 10 cents" (WRONG)

    const thoughts = SessionManager.getThoughts(sessionId);
    const drift = analyzeConfidenceDrift(thoughts);

    expect(drift.pattern).toBe("v_shaped");
    expect(drift.unresolved).toBe(true);
    expect(drift.min_step).toBe(3);
    expect(drift.explanation).toContain("pushed through");
  });

  test("correct careful reasoning: gradual build-up", () => {
    // Model correctly works through problem with increasing confidence
    addThoughtWithConfidence(sessionId, 1, 0.5); // "Let me set up equations"
    addThoughtWithConfidence(sessionId, 2, 0.65); // "Let x = ball price"
    addThoughtWithConfidence(sessionId, 3, 0.75); // "x + (x + 1) = 1.10"
    addThoughtWithConfidence(sessionId, 4, 0.85); // "2x = 0.10, x = 0.05"
    addThoughtWithConfidence(sessionId, 5, 0.95); // "Ball = 5 cents" (CORRECT)

    const thoughts = SessionManager.getThoughts(sessionId);
    const drift = analyzeConfidenceDrift(thoughts);

    expect(drift.pattern).toBe("improving");
    expect(drift.unresolved).toBe(false);
  });

  test("lily pad trap: exponential thinking catches doubt", () => {
    // "If lily pad doubles daily and covers lake in 48 days, when half?"
    addThoughtWithConfidence(sessionId, 1, 0.8); // "Doubling problem"
    addThoughtWithConfidence(sessionId, 2, 0.4); // "Wait, is it 24 days? No..."
    addThoughtWithConfidence(sessionId, 3, 0.75); // "It doubles, so half is day before"
    addThoughtWithConfidence(sessionId, 4, 0.9); // "47 days"

    const thoughts = SessionManager.getThoughts(sessionId);
    const drift = analyzeConfidenceDrift(thoughts);

    // This is V-shaped but the answer is correct - CDD flags it for review anyway
    expect(drift.pattern).toBe("v_shaped");
    expect(drift.min_step).toBe(2);
    // May or may not be unresolved depending on drift score
  });

  test("Monty Hall: V-shaped takes priority over oscillating", () => {
    // Even with oscillation, V-shaped (drop + recovery) is prioritized
    // because it's the more actionable warning pattern
    addThoughtWithConfidence(sessionId, 1, 0.7);
    addThoughtWithConfidence(sessionId, 2, 0.4); // down - min point
    addThoughtWithConfidence(sessionId, 3, 0.8); // up
    addThoughtWithConfidence(sessionId, 4, 0.5); // down
    addThoughtWithConfidence(sessionId, 5, 0.85); // up
    addThoughtWithConfidence(sessionId, 6, 0.4); // down
    addThoughtWithConfidence(sessionId, 7, 0.9); // up - recovery

    const thoughts = SessionManager.getThoughts(sessionId);
    const drift = analyzeConfidenceDrift(thoughts);

    // V-shaped takes priority since there's a clear drop and recovery
    expect(drift.pattern).toBe("v_shaped");
    expect(drift.min_step).toBe(2);
  });

  test("pure oscillating pattern (no significant V shape)", () => {
    // Small oscillations without major drop/recovery
    addThoughtWithConfidence(sessionId, 1, 0.7);
    addThoughtWithConfidence(sessionId, 2, 0.65); // small down
    addThoughtWithConfidence(sessionId, 3, 0.72); // small up
    addThoughtWithConfidence(sessionId, 4, 0.68); // small down
    addThoughtWithConfidence(sessionId, 5, 0.74); // small up
    addThoughtWithConfidence(sessionId, 6, 0.66); // small down

    const thoughts = SessionManager.getThoughts(sessionId);
    const drift = analyzeConfidenceDrift(thoughts);

    // Range is 0.09, below 0.1 threshold for stable
    // This should be stable due to low variance
    expect(drift.pattern).toBe("stable");
  });
});

describe("CDD Edge Cases", () => {
  let sessionId: string;

  beforeEach(() => {
    sessionId = createSession();
  });

  afterEach(() => {
    SessionManager.clear(sessionId);
  });

  test("handles missing verification data gracefully", () => {
    // Add thought without verification
    const record: ThoughtRecord = {
      id: `${sessionId}:main:1`,
      step_number: 1,
      thought: "No confidence",
      timestamp: Date.now(),
      branch_id: "main",
      // No verification field
    };
    SessionManager.addThought(sessionId, record);
    SessionManager.addThought(sessionId, {
      ...record,
      id: `${sessionId}:main:2`,
      step_number: 2,
    });
    SessionManager.addThought(sessionId, {
      ...record,
      id: `${sessionId}:main:3`,
      step_number: 3,
    });

    const thoughts = SessionManager.getThoughts(sessionId);
    const drift = analyzeConfidenceDrift(thoughts);

    // Should default to 0.5 and be stable
    expect(drift.pattern).toBe("stable");
    expect(drift.min_confidence).toBe(0.5);
  });

  test("handles extreme confidence drop", () => {
    addThoughtWithConfidence(sessionId, 1, 1.0);
    addThoughtWithConfidence(sessionId, 2, 0.0);
    addThoughtWithConfidence(sessionId, 3, 1.0);

    const thoughts = SessionManager.getThoughts(sessionId);
    const drift = analyzeConfidenceDrift(thoughts);

    expect(drift.pattern).toBe("v_shaped");
    expect(drift.unresolved).toBe(true);
    expect(drift.max_drop).toBe(1.0);
    expect(drift.drift_score).toBeGreaterThanOrEqual(0.5);
  });

  test("late revision after drop resolves unresolved flag", () => {
    addThoughtWithConfidence(sessionId, 1, 0.9);
    addThoughtWithConfidence(sessionId, 2, 0.4); // Drop point
    addThoughtWithConfidence(sessionId, 3, 0.6);
    addThoughtWithConfidence(sessionId, 4, 0.85, { revisesStep: 2 }); // Late revision

    const thoughts = SessionManager.getThoughts(sessionId);
    const drift = analyzeConfidenceDrift(thoughts);

    expect(drift.has_revision_after_drop).toBe(true);
    expect(drift.unresolved).toBe(false);
  });
});
