/**
 * Tests for Confidence Drift Detection (CDD)
 *
 * Novel technique that analyzes confidence trajectory shape as a meta-signal
 * for reasoning quality.
 */

import { describe, expect, test } from "bun:test";
import type { ThoughtRecord } from "../src/session/manager";
import {
  analyzeConfidenceDrift,
  computeTrajectoryStats,
  extractConfidenceTrajectory,
  hasConcerningDrift,
} from "../src/think/confidence-drift";

// ============================================================================
// HELPERS
// ============================================================================

function makeSteps(confidences: number[], options?: { revisesAt?: number[] }): ThoughtRecord[] {
  return confidences.map((conf, i) => ({
    id: `step-${i + 1}`,
    step_number: i + 1,
    thought: `Step ${i + 1} reasoning`,
    timestamp: Date.now(),
    branch_id: "main",
    verification: {
      passed: true,
      confidence: conf,
      domain: "math",
    },
    revises_step: options?.revisesAt?.includes(i + 1) ? i : undefined,
  }));
}

// ============================================================================
// PATTERN CLASSIFICATION TESTS
// ============================================================================

describe("Confidence Drift Detection", () => {
  describe("Pattern Classification", () => {
    test("detects stable pattern when confidence is flat", () => {
      const steps = makeSteps([0.8, 0.82, 0.79, 0.81, 0.8]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("stable");
      expect(result.unresolved).toBe(false);
      expect(result.drift_score).toBeLessThan(0.1);
    });

    test("detects declining pattern", () => {
      const steps = makeSteps([0.9, 0.8, 0.7, 0.6, 0.5]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("declining");
      expect(result.unresolved).toBe(false);
    });

    test("detects improving pattern", () => {
      const steps = makeSteps([0.5, 0.6, 0.7, 0.8, 0.9]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("improving");
      expect(result.unresolved).toBe(false);
    });

    test("detects V-shaped pattern without revision (UNRESOLVED)", () => {
      // Classic problematic pattern: drop then recovery without addressing
      const steps = makeSteps([0.9, 0.85, 0.5, 0.55, 0.85]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("v_shaped");
      expect(result.unresolved).toBe(true);
      expect(result.max_drop).toBeGreaterThanOrEqual(0.3);
      expect(result.recovery).toBeGreaterThanOrEqual(0.3);
      expect(result.has_revision_after_drop).toBe(false);
      expect(result.suggestion).not.toBeNull();
    });

    test("detects V-shaped pattern WITH revision (RESOLVED)", () => {
      // Same shape but with revision step - uncertainty was addressed
      const steps = makeSteps([0.9, 0.85, 0.5, 0.55, 0.85], { revisesAt: [4] });
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("v_shaped");
      expect(result.unresolved).toBe(false);
      expect(result.has_revision_after_drop).toBe(true);
      expect(result.suggestion).toBeNull();
    });

    test("detects cliff pattern (late drop)", () => {
      const steps = makeSteps([0.9, 0.88, 0.85, 0.82, 0.4]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("cliff");
      // Cliff with drop >= 0.3 is now flagged as unresolved (S1)
      expect(result.unresolved).toBe(true);
    });

    test("detects oscillating pattern", () => {
      const steps = makeSteps([0.7, 0.5, 0.8, 0.4, 0.9, 0.5]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("oscillating");
    });

    test("returns insufficient for too few steps", () => {
      const steps = makeSteps([0.8, 0.5]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("insufficient");
      expect(result.unresolved).toBe(false);
    });
  });

  // ============================================================================
  // DRIFT SCORE CALCULATION
  // ============================================================================

  describe("Drift Score Calculation", () => {
    test("higher drop + recovery = higher drift score", () => {
      const mildDrift = makeSteps([0.9, 0.8, 0.7, 0.8, 0.9]);
      const severeDrift = makeSteps([0.9, 0.8, 0.3, 0.5, 0.9]);

      const mildResult = analyzeConfidenceDrift(mildDrift);
      const severeResult = analyzeConfidenceDrift(severeDrift);

      expect(severeResult.drift_score).toBeGreaterThan(mildResult.drift_score);
    });

    test("drift score is bounded 0-1", () => {
      const extreme = makeSteps([1.0, 0.0, 1.0]);
      const result = analyzeConfidenceDrift(extreme);

      expect(result.drift_score).toBeGreaterThanOrEqual(0);
      expect(result.drift_score).toBeLessThanOrEqual(1);
    });

    test("no drift when confidence is monotonic", () => {
      const monotonic = makeSteps([0.5, 0.6, 0.7, 0.8, 0.9]);
      const result = analyzeConfidenceDrift(monotonic);

      expect(result.drift_score).toBeLessThan(0.2);
      expect(result.unresolved).toBe(false);
    });
  });

  // ============================================================================
  // MINIMUM TRACKING
  // ============================================================================

  describe("Minimum Point Detection", () => {
    test("correctly identifies minimum step", () => {
      const steps = makeSteps([0.9, 0.7, 0.4, 0.6, 0.8]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.min_confidence).toBe(0.4);
      expect(result.min_step).toBe(3);
    });

    test("handles minimum at start", () => {
      const steps = makeSteps([0.3, 0.5, 0.7, 0.8]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.min_step).toBe(1);
      expect(result.pattern).not.toBe("v_shaped"); // Not V-shaped if min at start
    });

    test("handles minimum at end", () => {
      const steps = makeSteps([0.9, 0.8, 0.7, 0.4]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.min_step).toBe(4);
      expect(result.pattern).toBe("cliff");
    });
  });

  // ============================================================================
  // REVISION DETECTION
  // ============================================================================

  describe("Revision Step Detection", () => {
    test("detects revision after drop point", () => {
      const steps = makeSteps([0.9, 0.5, 0.8], { revisesAt: [3] });
      const result = analyzeConfidenceDrift(steps);

      expect(result.has_revision_after_drop).toBe(true);
    });

    test("ignores revision before drop point", () => {
      const steps: ThoughtRecord[] = [
        {
          id: "step-1",
          step_number: 1,
          thought: "Initial",
          timestamp: Date.now(),
          branch_id: "main",
          verification: { passed: true, confidence: 0.9, domain: "math" },
          revises_step: undefined,
        },
        {
          id: "step-2",
          step_number: 2,
          thought: "Revised early",
          timestamp: Date.now(),
          branch_id: "main",
          verification: { passed: true, confidence: 0.85, domain: "math" },
          revises_step: 1, // Revision before drop
        },
        {
          id: "step-3",
          step_number: 3,
          thought: "Drop point",
          timestamp: Date.now(),
          branch_id: "main",
          verification: { passed: true, confidence: 0.4, domain: "math" },
        },
        {
          id: "step-4",
          step_number: 4,
          thought: "Recovery",
          timestamp: Date.now(),
          branch_id: "main",
          verification: { passed: true, confidence: 0.85, domain: "math" },
        },
      ];

      const result = analyzeConfidenceDrift(steps);
      expect(result.has_revision_after_drop).toBe(false);
    });
  });

  // ============================================================================
  // CONVENIENCE FUNCTIONS
  // ============================================================================

  describe("hasConcerningDrift (quick check)", () => {
    test("returns true for unresolved V-shape", () => {
      const steps = makeSteps([0.9, 0.5, 0.9]);
      expect(hasConcerningDrift(steps)).toBe(true);
    });

    test("returns false for stable trajectory", () => {
      const steps = makeSteps([0.8, 0.8, 0.8, 0.8]);
      expect(hasConcerningDrift(steps)).toBe(false);
    });

    test("returns false for insufficient steps", () => {
      const steps = makeSteps([0.9, 0.3]);
      expect(hasConcerningDrift(steps)).toBe(false);
    });

    test("returns false when revision exists", () => {
      const steps = makeSteps([0.9, 0.5, 0.9], { revisesAt: [3] });
      expect(hasConcerningDrift(steps)).toBe(false);
    });
  });

  describe("extractConfidenceTrajectory", () => {
    test("extracts step numbers and confidences", () => {
      const steps = makeSteps([0.9, 0.7, 0.8]);
      const trajectory = extractConfidenceTrajectory(steps);

      expect(trajectory).toEqual([
        { step: 1, confidence: 0.9 },
        { step: 2, confidence: 0.7 },
        { step: 3, confidence: 0.8 },
      ]);
    });

    test("uses default 0.5 for missing confidence", () => {
      const steps: ThoughtRecord[] = [
        {
          id: "step-1",
          step_number: 1,
          thought: "No verification",
          timestamp: Date.now(),
          branch_id: "main",
        },
      ];

      const trajectory = extractConfidenceTrajectory(steps);
      expect(trajectory[0]!.confidence).toBe(0.5);
    });
  });

  describe("computeTrajectoryStats", () => {
    test("computes mean correctly", () => {
      const steps = makeSteps([0.4, 0.6, 0.8]);
      const stats = computeTrajectoryStats(steps);

      expect(stats.mean).toBeCloseTo(0.6, 2);
    });

    test("computes min/max correctly", () => {
      const steps = makeSteps([0.3, 0.9, 0.5]);
      const stats = computeTrajectoryStats(steps);

      expect(stats.min).toBe(0.3);
      expect(stats.max).toBe(0.9);
    });

    test("detects upward trend", () => {
      const steps = makeSteps([0.3, 0.5, 0.7, 0.9]);
      const stats = computeTrajectoryStats(steps);

      expect(stats.trend).toBe("up");
    });

    test("detects downward trend", () => {
      const steps = makeSteps([0.9, 0.7, 0.5, 0.3]);
      const stats = computeTrajectoryStats(steps);

      expect(stats.trend).toBe("down");
    });

    test("detects flat trend", () => {
      const steps = makeSteps([0.7, 0.7, 0.7, 0.7]);
      const stats = computeTrajectoryStats(steps);

      expect(stats.trend).toBe("flat");
    });

    test("handles empty array", () => {
      const stats = computeTrajectoryStats([]);

      expect(stats.mean).toBe(0.5);
      expect(stats.trend).toBe("flat");
    });
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe("Edge Cases", () => {
    test("handles all same confidence values", () => {
      const steps = makeSteps([0.7, 0.7, 0.7, 0.7, 0.7]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("stable");
      expect(result.drift_score).toBe(0);
    });

    test("handles missing verification data gracefully", () => {
      const steps: ThoughtRecord[] = [
        {
          id: "1",
          step_number: 1,
          thought: "a",
          timestamp: Date.now(),
          branch_id: "main",
        },
        {
          id: "2",
          step_number: 2,
          thought: "b",
          timestamp: Date.now(),
          branch_id: "main",
        },
        {
          id: "3",
          step_number: 3,
          thought: "c",
          timestamp: Date.now(),
          branch_id: "main",
        },
      ];

      const result = analyzeConfidenceDrift(steps);
      expect(result.pattern).toBe("stable"); // All default to 0.5
    });

    test("handles exactly 3 steps (minimum)", () => {
      const steps = makeSteps([0.9, 0.3, 0.9]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("v_shaped");
      expect(result.unresolved).toBe(true);
    });

    test("custom config overrides defaults", () => {
      const steps = makeSteps([0.9, 0.8, 0.9]); // Small drop

      // With default config (0.15 threshold), not significant
      const defaultResult = analyzeConfidenceDrift(steps);
      expect(defaultResult.pattern).toBe("stable");

      // With lower threshold, becomes V-shaped
      const strictResult = analyzeConfidenceDrift(steps, {
        min_significant_drop: 0.05,
        min_significant_recovery: 0.05,
      });
      expect(strictResult.pattern).toBe("v_shaped");
    });
  });

  // ============================================================================
  // EXPLANATION GENERATION
  // ============================================================================

  describe("Explanation Generation", () => {
    test("V-shaped unresolved includes warning emoji", () => {
      const steps = makeSteps([0.9, 0.4, 0.9]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.explanation).toContain("⚠️");
      expect(result.explanation).toContain("pushed through");
    });

    test("V-shaped with revision is reassuring", () => {
      const steps = makeSteps([0.9, 0.4, 0.9], { revisesAt: [3] });
      const result = analyzeConfidenceDrift(steps);

      expect(result.explanation).toContain("addressed");
      expect(result.explanation).not.toContain("⚠️");
    });

    test("suggestion includes step number for large drops", () => {
      const steps = makeSteps([0.9, 0.3, 0.9]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.suggestion).toContain("step 2");
      expect(result.suggestion).toContain("revising");
    });
  });

  // ============================================================================
  // REAL-WORLD SCENARIOS
  // ============================================================================

  describe("Real-World Scenarios", () => {
    test("bat-ball trap pattern: confident start, doubt, then wrong recovery", () => {
      // Simulates: confident → sees numbers → doubts → picks intuitive answer
      const steps = makeSteps([0.85, 0.75, 0.5, 0.6, 0.8]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("v_shaped");
      expect(result.unresolved).toBe(true);
      expect(result.min_step).toBe(3);
    });

    test("correct reasoning pattern: gradual confident build-up", () => {
      const steps = makeSteps([0.6, 0.65, 0.7, 0.8, 0.9]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("improving");
      expect(result.unresolved).toBe(false);
    });

    test("error-caught pattern: cliff at end when contradiction found", () => {
      const steps = makeSteps([0.9, 0.85, 0.82, 0.8, 0.3]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("cliff");
      expect(result.explanation).toContain("dropped sharply");
    });

    test("careful reasoning: recovers via explicit revision", () => {
      const steps = makeSteps([0.9, 0.5, 0.6, 0.85], { revisesAt: [4] });
      const result = analyzeConfidenceDrift(steps);

      expect(result.has_revision_after_drop).toBe(true);
      expect(result.unresolved).toBe(false);
    });
  });

  // ============================================================================
  // STABLE OVERCONFIDENT PATTERN (S2)
  // ============================================================================

  describe("Stable Overconfident Pattern", () => {
    test("detects stable_overconfident when all confidence >= 0.85 with low variance", () => {
      // This is concerning on trap questions - LLM is confidently wrong
      const steps = makeSteps([0.9, 0.88, 0.92, 0.89, 0.91]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("stable_overconfident");
      expect(result.unresolved).toBe(true);
      expect(result.drift_score).toBeGreaterThanOrEqual(0.4); // Moderate concern
    });

    test("stable_overconfident includes warning in explanation", () => {
      const steps = makeSteps([0.9, 0.88, 0.9, 0.87, 0.9]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.explanation).toContain("⚠️");
      expect(result.explanation).toContain("high confidence");
      expect(result.explanation).toContain("incorrect answers");
    });

    test("stable_overconfident suggestion mentions self-check", () => {
      const steps = makeSteps([0.92, 0.9, 0.91, 0.93]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.suggestion).not.toBeNull();
      expect(result.suggestion).toContain("self-check");
    });

    test("does NOT flag stable_overconfident when variance is high", () => {
      // High variance means doubt existed - not stable overconfident
      const steps = makeSteps([0.95, 0.85, 0.95, 0.87, 0.93]);
      const result = analyzeConfidenceDrift(steps);

      // Range is 0.1, exceeds max variance threshold of 0.05
      expect(result.pattern).not.toBe("stable_overconfident");
    });

    test("does NOT flag stable_overconfident when any confidence is below threshold", () => {
      // One step with 0.8 breaks the pattern
      const steps = makeSteps([0.9, 0.88, 0.8, 0.9, 0.89]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).not.toBe("stable_overconfident");
    });

    test("stable_overconfident is flagged regardless of revision steps", () => {
      // Even with revision, stable overconfidence is concerning
      const steps = makeSteps([0.9, 0.88, 0.91, 0.9], { revisesAt: [3] });
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("stable_overconfident");
      expect(result.unresolved).toBe(true);
    });

    test("custom threshold for overconfident detection", () => {
      // Default threshold is 0.85
      const steps = makeSteps([0.8, 0.78, 0.82, 0.79]);

      // With default config, not flagged (below 0.85)
      const defaultResult = analyzeConfidenceDrift(steps);
      expect(defaultResult.pattern).not.toBe("stable_overconfident");

      // With lower threshold, becomes flagged
      const customResult = analyzeConfidenceDrift(steps, {
        overconfident_threshold: 0.75,
        overconfident_max_variance: 0.05,
      });
      expect(customResult.pattern).toBe("stable_overconfident");
    });

    test("V-shaped takes precedence over stable_overconfident", () => {
      // Even if all values are high, V-shaped pattern is more specific
      const steps = makeSteps([0.95, 0.92, 0.7, 0.75, 0.93]);
      const result = analyzeConfidenceDrift(steps);

      // V-shaped is checked first because it indicates a specific uncertainty event
      expect(result.pattern).toBe("v_shaped");
    });

    test("exactly at threshold boundary is flagged", () => {
      const steps = makeSteps([0.85, 0.85, 0.85, 0.85]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("stable_overconfident");
    });
  });

  // ============================================================================
  // CLIFF PATTERN - UNRESOLVED DETECTION (S1)
  // ============================================================================

  describe("Cliff Pattern Unresolved Detection", () => {
    test("cliff with drop >= 0.3 is flagged as unresolved", () => {
      // Sharp drop at end indicates error detected but not addressed
      const steps = makeSteps([0.9, 0.85, 0.82, 0.8, 0.4]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("cliff");
      expect(result.unresolved).toBe(true);
      expect(result.drift_score).toBeGreaterThanOrEqual(0.4);
    });

    test("cliff with small drop is NOT flagged as unresolved", () => {
      // Moderate drop at end - not severe enough to flag
      const steps = makeSteps([0.9, 0.85, 0.82, 0.8, 0.65]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("cliff");
      expect(result.unresolved).toBe(false);
    });

    test("cliff suggestion mentions late error detection", () => {
      const steps = makeSteps([0.9, 0.88, 0.85, 0.82, 0.45]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("cliff");
      expect(result.unresolved).toBe(true);
      expect(result.suggestion).toContain("final step");
      expect(result.suggestion).toContain("error");
    });

    test("cliff explanation mentions sharp drop", () => {
      const steps = makeSteps([0.8, 0.78, 0.75, 0.72, 0.35]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("cliff");
      expect(result.explanation).toContain("dropped sharply");
    });

    test("custom cliff_drop_threshold", () => {
      const steps = makeSteps([0.9, 0.85, 0.82, 0.8, 0.6]);

      // Default threshold 0.3 - drop is 0.2, not flagged
      const defaultResult = analyzeConfidenceDrift(steps);
      expect(defaultResult.pattern).toBe("cliff");
      expect(defaultResult.unresolved).toBe(false);

      // Lower threshold 0.15 - now flagged
      const customResult = analyzeConfidenceDrift(steps, {
        cliff_drop_threshold: 0.15,
      });
      expect(customResult.pattern).toBe("cliff");
      expect(customResult.unresolved).toBe(true);
    });

    test("severe cliff drop of 0.5+ is flagged", () => {
      const steps = makeSteps([0.9, 0.88, 0.85, 0.9, 0.3]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("cliff");
      expect(result.unresolved).toBe(true);
      expect(result.max_drop).toBeGreaterThanOrEqual(0.5);
    });

    test("cliff with exact 0.3 drop is flagged (boundary)", () => {
      const steps = makeSteps([0.9, 0.85, 0.82, 0.8, 0.5]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("cliff");
      expect(result.unresolved).toBe(true);
    });
  });

  // ============================================================================
  // DECLINING PATTERN - UNRESOLVED DETECTION (S3)
  // ============================================================================

  describe("Declining Pattern Unresolved Detection", () => {
    test("declining with final confidence < 0.5 is flagged as unresolved", () => {
      // Steady decline ending with low confidence = ended uncertain
      const steps = makeSteps([0.8, 0.7, 0.6, 0.5, 0.45]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("declining");
      expect(result.unresolved).toBe(true);
      expect(result.drift_score).toBeGreaterThanOrEqual(0.4);
    });

    test("declining with final confidence >= 0.5 is NOT flagged as unresolved", () => {
      // Decline but ending with acceptable confidence
      const steps = makeSteps([0.9, 0.8, 0.7, 0.65, 0.55]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("declining");
      expect(result.unresolved).toBe(false);
    });

    test("declining explanation includes warning emoji when low confidence", () => {
      const steps = makeSteps([0.8, 0.7, 0.6, 0.5, 0.4]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("declining");
      expect(result.explanation).toContain("⚠️");
      expect(result.explanation).toContain("unresolved uncertainty");
    });

    test("declining suggestion mentions trying different method", () => {
      const steps = makeSteps([0.85, 0.7, 0.6, 0.45, 0.35]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("declining");
      expect(result.unresolved).toBe(true);
      expect(result.suggestion).toContain("different method");
    });

    test("custom declining_final_threshold", () => {
      const steps = makeSteps([0.9, 0.75, 0.65, 0.55, 0.45]);

      // Default threshold 0.5 - final is 0.45 < 0.5, flagged
      const defaultResult = analyzeConfidenceDrift(steps);
      expect(defaultResult.pattern).toBe("declining");
      expect(defaultResult.unresolved).toBe(true);

      // Higher threshold 0.6 - now flagged even earlier
      const customResult = analyzeConfidenceDrift(steps, {
        declining_final_threshold: 0.6,
      });
      expect(customResult.pattern).toBe("declining");
      expect(customResult.unresolved).toBe(true);

      // Lower threshold 0.3 - now NOT flagged
      const lowThresholdResult = analyzeConfidenceDrift(steps, {
        declining_final_threshold: 0.3,
      });
      expect(lowThresholdResult.pattern).toBe("declining");
      expect(lowThresholdResult.unresolved).toBe(false);
    });

    test("declining with exactly 0.5 final confidence is NOT flagged (boundary)", () => {
      const steps = makeSteps([0.9, 0.8, 0.7, 0.6, 0.5]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("declining");
      expect(result.unresolved).toBe(false); // >= 0.5 is ok
    });

    test("steep decline to very low confidence is flagged", () => {
      const steps = makeSteps([0.9, 0.7, 0.5, 0.3, 0.2]);
      const result = analyzeConfidenceDrift(steps);

      expect(result.pattern).toBe("declining");
      expect(result.unresolved).toBe(true);
      expect(result.min_confidence).toBe(0.2);
    });
  });
});
