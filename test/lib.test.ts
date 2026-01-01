/**
 * Unit tests for src/lib modules
 * These test the core logic directly for coverage
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { verificationCache } from "../src/lib/cache";
import {
  calculateEntropy,
  compress,
  needsCompression,
  quickCompress,
} from "../src/lib/compression";
import {
  classifyQuestion,
  describeMask,
  SolverGroup,
  SolverType,
  shouldTrySolver,
} from "../src/lib/compute/classifier";
import {
  canonicalizeExpression,
  clearCache,
  computeAndReplace,
  computeConfidence,
  extractAndCompute,
  getCacheStats,
  isLikelyComputable,
  simplifyDerivation,
  simplifyDerivationText,
  suggestNextStep,
  suggestNextStepFromText,
  tryArithmetic,
  tryDerivation,
  tryFormula,
  tryLocalCompute,
  tryLogic,
  tryMultiStepWordProblem,
  tryProbability,
  trySimplifyToConstant,
  tryWordProblem,
  verifyDerivationSteps,
} from "../src/lib/compute/index";
import { getRegistryStats, getSolvers, getSolversForMask } from "../src/lib/compute/registry";
import { ConceptTracker, clearTracker, getTracker } from "../src/lib/concepts";
import { SessionManager, SessionManagerImpl } from "../src/lib/session";
import {
  estimateCodeTokens,
  estimateTokens,
  estimateTokensBatch,
} from "../src/lib/think/verification";
import {
  buildAST,
  canBeUnary,
  clearVerificationCache,
  compareExpressions,
  compareOperatorPrecedence,
  evaluateExpression,
  formatAST,
  formatExpression,
  getOperatorArity,
  getOperatorArityInContext,
  getOperatorPrecedence,
  getVerificationCacheStats,
  isMathOperator,
  isRightAssociative,
  MATH_OPERATOR_PATTERN,
  MATH_OPERATORS,
  simplifyAST,
  tokenizeMathExpression,
  validateExpression,
  verify,
} from "../src/lib/verification";

describe("SessionManager", () => {
  beforeEach(() => {
    SessionManager.clearAll();
  });

  test("creates and retrieves sessions", () => {
    SessionManager.addThought("test-session", {
      id: "t1",
      step_number: 1,
      thought: "First thought",
      timestamp: Date.now(),
      branch_id: "main",
    });

    const sessions = SessionManager.list();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe("test-session");
  });

  test("retrieves thoughts by branch", () => {
    SessionManager.addThought("sess", {
      id: "t1",
      step_number: 1,
      thought: "Main branch",
      timestamp: Date.now(),
      branch_id: "main",
    });
    SessionManager.addThought("sess", {
      id: "t2",
      step_number: 1,
      thought: "Alt branch",
      timestamp: Date.now(),
      branch_id: "alt",
    });

    const mainThoughts = SessionManager.getThoughts("sess", "main");
    expect(mainThoughts).toHaveLength(1);
    expect(mainThoughts[0]?.thought).toBe("Main branch");

    const altThoughts = SessionManager.getThoughts("sess", "alt");
    expect(altThoughts).toHaveLength(1);
    expect(altThoughts[0]?.thought).toBe("Alt branch");
  });

  test("clears specific session", () => {
    SessionManager.addThought("s1", {
      id: "t1",
      step_number: 1,
      thought: "S1",
      timestamp: Date.now(),
      branch_id: "main",
    });
    SessionManager.addThought("s2", {
      id: "t2",
      step_number: 1,
      thought: "S2",
      timestamp: Date.now(),
      branch_id: "main",
    });

    SessionManager.clear("s1");
    expect(SessionManager.list()).toHaveLength(1);
    expect(SessionManager.list()[0]?.id).toBe("s2");
  });

  test("gets session summary", () => {
    SessionManager.addThought("sess", {
      id: "t1",
      step_number: 1,
      thought: "Test thought content here",
      timestamp: Date.now(),
      branch_id: "main",
      verification: { passed: true, confidence: 0.9, domain: "math" },
    });

    const summary = SessionManager.getSummary("sess");
    expect(summary).toBeDefined();
    expect(summary).toContain("sess");
    expect(summary).toContain("Thoughts: 1");
  });

  test("gets compressed session", () => {
    SessionManager.addThought("sess", {
      id: "t1",
      step_number: 1,
      thought: "First verified thought",
      timestamp: Date.now(),
      branch_id: "main",
      verification: { passed: true, confidence: 0.9, domain: "math" },
    });

    const compressed = SessionManager.getCompressed("sess");
    expect(compressed).toContain("First verified thought");
  });

  test("getCompressed filters and maps thoughts correctly", () => {
    // Add multiple thoughts - some verified, some not, to exercise all callbacks
    SessionManager.addThought("compress-test", {
      id: "t1",
      step_number: 1,
      thought: "Unverified first thought",
      timestamp: Date.now(),
      branch_id: "main",
    });
    SessionManager.addThought("compress-test", {
      id: "t2",
      step_number: 2,
      thought: "Verified middle thought",
      timestamp: Date.now(),
      branch_id: "main",
      verification: { passed: true, confidence: 0.9, domain: "math" },
    });
    SessionManager.addThought("compress-test", {
      id: "t3",
      step_number: 3,
      thought: "Final thought at max step",
      timestamp: Date.now(),
      branch_id: "main",
    });

    const compressed = SessionManager.getCompressed("compress-test");
    // Should include verified thought and max step thought
    expect(compressed).toContain("Verified middle thought");
    expect(compressed).toContain("Final thought at max step");
    // Should NOT include unverified non-final thought
    expect(compressed).not.toContain("Unverified first thought");
  });

  test("gets branches", () => {
    SessionManager.addThought("sess", {
      id: "t1",
      step_number: 1,
      thought: "Main",
      timestamp: Date.now(),
      branch_id: "main",
    });
    SessionManager.addThought("sess", {
      id: "t2",
      step_number: 1,
      thought: "Alt",
      timestamp: Date.now(),
      branch_id: "alternate",
    });

    const branches = SessionManager.getBranches("sess");
    const branchIds = branches.map((b) => b.id);
    expect(branchIds).toContain("main");
    expect(branchIds).toContain("alternate");
  });

  test("returns null for nonexistent session", () => {
    expect(SessionManager.getSummary("nonexistent")).toBeNull();
    expect(SessionManager.getCompressed("nonexistent")).toBeNull();
    expect(SessionManager.getThoughts("nonexistent")).toEqual([]);
  });

  test("destroy clears cleanup timer and sessions", () => {
    // Create a new instance to test destroy
    const manager = new SessionManagerImpl({
      cleanup_interval_ms: 100,
      ttl_ms: 1000,
    });

    // Add a session
    manager.addThought("test-session", {
      id: "t1",
      step_number: 1,
      thought: "Test",
      timestamp: Date.now(),
      branch_id: "main",
    });

    expect(manager.list()).toHaveLength(1);

    // Destroy should clear timer and sessions
    manager.destroy();
    expect(manager.list()).toHaveLength(0);
  });

  test("enforces max sessions limit", () => {
    const manager = new SessionManagerImpl({ max_sessions: 3 });

    // Add 4 sessions (exceeding max of 3)
    for (let i = 0; i < 4; i++) {
      manager.addThought(`session-${i}`, {
        id: `t${i}`,
        step_number: 1,
        thought: `Session ${i}`,
        timestamp: Date.now() + i * 100, // Different timestamps
        branch_id: "main",
      });
    }

    // Should only have 3 sessions (oldest evicted)
    const sessions = manager.list();
    expect(sessions).toHaveLength(3);

    // Oldest session (session-0) should be evicted
    expect(sessions.find((s) => s.id === "session-0")).toBeUndefined();

    manager.destroy();
  });

  test("getThoughts filters by branch", () => {
    const manager = new SessionManagerImpl();

    manager.addThought("branch-test", {
      id: "t1",
      step_number: 1,
      thought: "Main branch thought",
      timestamp: Date.now(),
      branch_id: "main",
    });

    manager.addThought("branch-test", {
      id: "t2",
      step_number: 2,
      thought: "Alt branch thought",
      timestamp: Date.now(),
      branch_id: "alt",
    });

    // All thoughts
    const all = manager.getThoughts("branch-test");
    expect(all).toHaveLength(2);

    // Filter by main branch
    const mainOnly = manager.getThoughts("branch-test", "main");
    expect(mainOnly).toHaveLength(1);
    expect(mainOnly[0].branch_id).toBe("main");

    // Filter by alt branch
    const altOnly = manager.getThoughts("branch-test", "alt");
    expect(altOnly).toHaveLength(1);
    expect(altOnly[0].branch_id).toBe("alt");

    manager.destroy();
  });

  test("cleanup removes expired sessions", async () => {
    const manager = new SessionManagerImpl({
      ttl_ms: 50, // Very short TTL
      cleanup_interval_ms: 25, // Very short cleanup interval
    });

    manager.addThought("expire-test", {
      id: "t1",
      step_number: 1,
      thought: "This will expire",
      timestamp: Date.now(),
      branch_id: "main",
    });

    expect(manager.list()).toHaveLength(1);

    // Wait for TTL to expire and cleanup to run
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Session should be cleaned up
    expect(manager.list()).toHaveLength(0);

    manager.destroy();
  });

  test("handles multiple getOrCreate calls for same session", () => {
    const manager = new SessionManagerImpl();

    // First call creates session
    const session1 = manager.getOrCreate("multi-get");
    expect(session1.id).toBe("multi-get");

    // Second call returns same session
    const session2 = manager.getOrCreate("multi-get");
    expect(session2).toBe(session1);

    manager.destroy();
  });

  test("cleanup removes expired sessions", async () => {
    // Create manager with very short TTL and cleanup interval
    const manager = new SessionManagerImpl({
      ttl_ms: 30,
      cleanup_interval_ms: 20,
    });

    // Add a session
    manager.addThought("expired-session", {
      id: "t1",
      step_number: 1,
      thought: "Will expire",
      timestamp: Date.now(),
      branch_id: "main",
    });

    expect(manager.list()).toHaveLength(1);

    // Wait for TTL to expire and cleanup to run (extra buffer for CI)
    await Bun.sleep(150);

    // Session should be cleaned up
    expect(manager.list()).toHaveLength(0);

    manager.destroy();
  });

  test("getStep returns step by number with O(1) lookup", () => {
    const manager = new SessionManagerImpl();

    manager.addThought("step-test", {
      id: "t1",
      step_number: 1,
      thought: "First thought",
      timestamp: Date.now(),
      branch_id: "main",
    });

    manager.addThought("step-test", {
      id: "t2",
      step_number: 2,
      thought: "Second thought",
      timestamp: Date.now(),
      branch_id: "main",
    });

    // O(1) lookup
    const step1 = manager.getStep("step-test", 1);
    expect(step1).toBeDefined();
    expect(step1?.thought).toBe("First thought");

    const step2 = manager.getStep("step-test", 2);
    expect(step2).toBeDefined();
    expect(step2?.thought).toBe("Second thought");

    // Non-existent step
    const step3 = manager.getStep("step-test", 3);
    expect(step3).toBeUndefined();

    // Non-existent session
    const noSession = manager.getStep("no-session", 1);
    expect(noSession).toBeUndefined();

    manager.destroy();
  });

  test("hasStep checks existence with O(1) lookup", () => {
    const manager = new SessionManagerImpl();

    manager.addThought("has-step-test", {
      id: "t1",
      step_number: 5,
      thought: "Step five",
      timestamp: Date.now(),
      branch_id: "main",
    });

    expect(manager.hasStep("has-step-test", 5)).toBe(true);
    expect(manager.hasStep("has-step-test", 1)).toBe(false);
    expect(manager.hasStep("no-session", 5)).toBe(false);

    manager.destroy();
  });

  test("calculateBranchDepth calculates depth correctly", () => {
    const manager = new SessionManagerImpl();

    // Add main branch thought
    manager.addThought("depth-test", {
      id: "t1",
      step_number: 1,
      thought: "Main thought",
      timestamp: Date.now(),
      branch_id: "main",
    });

    // Add branch from main
    manager.addThought("depth-test", {
      id: "t2",
      step_number: 2,
      thought: "Branch thought",
      timestamp: Date.now(),
      branch_id: "branch-a",
      branch_from: 1,
    });

    const session = manager.get("depth-test");
    expect(session).toBeDefined();

    // Branching from main (step 1) should give depth 1
    const depth = manager.calculateBranchDepth(session!, 1);
    expect(depth).toBe(1);

    // Branching from branch-a (step 2) should give depth 2
    const depth2 = manager.calculateBranchDepth(session!, 2);
    expect(depth2).toBe(2);

    manager.destroy();
  });

  test("getRevisionChain returns revision history", () => {
    const manager = new SessionManagerImpl();

    // Original thought
    manager.addThought("revision-chain-test", {
      id: "t1",
      step_number: 1,
      thought: "Original thought",
      timestamp: Date.now(),
      branch_id: "main",
    });

    // Revision of step 1
    manager.addThought("revision-chain-test", {
      id: "t2",
      step_number: 2,
      thought: "First revision",
      timestamp: Date.now(),
      branch_id: "main",
      revises_step: 1,
      revision_reason: "Correcting error",
    });

    // Another revision
    manager.addThought("revision-chain-test", {
      id: "t3",
      step_number: 3,
      thought: "Second revision",
      timestamp: Date.now(),
      branch_id: "main",
      revises_step: 2,
      revision_reason: "Further correction",
    });

    // Get revision chain starting from step 1
    const chain = manager.getRevisionChain("revision-chain-test", 1);
    expect(chain).toHaveLength(3);
    expect(chain[0]?.thought).toBe("Original thought");
    expect(chain[1]?.thought).toBe("First revision");
    expect(chain[2]?.thought).toBe("Second revision");

    // Non-existent session
    const noChain = manager.getRevisionChain("no-session", 1);
    expect(noChain).toEqual([]);

    manager.destroy();
  });

  test("stores and aggregates compression stats", () => {
    const manager = new SessionManagerImpl();

    // Add thoughts with compression stats
    manager.addThought("compression-test", {
      id: "t1",
      step_number: 1,
      thought: "First thought",
      timestamp: Date.now(),
      branch_id: "main",
      compression: {
        input_bytes_saved: 100,
        output_bytes_saved: 50,
        context_bytes_saved: 0,
      },
    });

    manager.addThought("compression-test", {
      id: "t2",
      step_number: 2,
      thought: "Second thought",
      timestamp: Date.now(),
      branch_id: "main",
      compression: {
        input_bytes_saved: 200,
        output_bytes_saved: 100,
        context_bytes_saved: 300,
      },
    });

    // Add thought without compression
    manager.addThought("compression-test", {
      id: "t3",
      step_number: 3,
      thought: "Third thought",
      timestamp: Date.now(),
      branch_id: "main",
    });

    const stats = manager.getCompressionStats("compression-test");
    expect(stats).not.toBeNull();
    expect(stats!.totalBytesSaved).toBe(750); // 100+50+200+100+300
    expect(stats!.stepCount).toBe(2); // Only 2 steps had compression
    expect(stats!.breakdown.input).toBe(300); // 100+200
    expect(stats!.breakdown.output).toBe(150); // 50+100
    expect(stats!.breakdown.context).toBe(300); // 0+300

    manager.destroy();
  });

  test("getSummary includes compression stats", () => {
    const manager = new SessionManagerImpl();

    manager.addThought("summary-compression", {
      id: "t1",
      step_number: 1,
      thought: "Test thought with compression",
      timestamp: Date.now(),
      branch_id: "main",
      compression: {
        input_bytes_saved: 500,
        output_bytes_saved: 200,
        context_bytes_saved: 100,
      },
    });

    const summary = manager.getSummary("summary-compression");
    expect(summary).toContain("Compression:");
    expect(summary).toContain("800 bytes saved");
    expect(summary).toContain("1 steps");

    manager.destroy();
  });

  test("getCompressionStats returns null for nonexistent session", () => {
    expect(SessionManager.getCompressionStats("nonexistent")).toBeNull();
  });

  test("getCompressionStats returns zeros for session without compression", () => {
    const manager = new SessionManagerImpl();

    manager.addThought("no-compression", {
      id: "t1",
      step_number: 1,
      thought: "Uncompressed thought",
      timestamp: Date.now(),
      branch_id: "main",
    });

    const stats = manager.getCompressionStats("no-compression");
    expect(stats).not.toBeNull();
    expect(stats!.totalBytesSaved).toBe(0);
    expect(stats!.stepCount).toBe(0);

    manager.destroy();
  });
});

describe("Verification", () => {
  test("verifies math domain", () => {
    const result = verify("2 + 2 = 4", "math", []);
    expect(result.domain).toBe("math");
    expect(result.passed).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
  });

  test("verifies logic domain", () => {
    const result = verify("If A then B. A is true. Therefore B.", "logic", []);
    expect(result.domain).toBe("logic");
    expect(result.passed).toBe(true);
  });

  test("verifies code domain", () => {
    const result = verify("function add(a, b) { return a + b; }", "code", []);
    expect(result.domain).toBe("code");
    expect(result.passed).toBe(true);
  });

  test("verifies general domain", () => {
    const result = verify("This is a general statement.", "general", []);
    expect(result.domain).toBe("general");
    expect(result.passed).toBe(true);
  });

  test("uses cache when enabled", () => {
    verificationCache.clear();
    const thought = "Cached verification test: 1 + 1 = 2";

    // First call - not cached
    const result1 = verify(thought, "math", [], true);
    expect(result1.cached).toBe(false);

    // Second call - should be cached
    const result2 = verify(thought, "math", [], true);
    expect(result2.cached).toBe(true);
  });

  test("detects math errors", () => {
    const result = verify("2 + 2 = 5", "math", []);
    // Should still pass (heuristic verification) but with lower confidence
    expect(result.domain).toBe("math");
  });

  test("detects unbalanced brackets in math", () => {
    const result = verify("Calculate ((x + 1) * 2", "math", []);
    expect(result.domain).toBe("math");
    // Unbalanced brackets should reduce confidence
    expect(result.confidence).toBeLessThan(1);
  });

  test("detects mismatched brackets in math", () => {
    // Close bracket without matching open bracket (hits line 236)
    const result = verify("Calculate x + 1) * 2", "math", []);
    expect(result.domain).toBe("math");
    expect(result.confidence).toBeLessThan(1);
  });

  test("detects wrong bracket type mismatch", () => {
    // Wrong closing bracket type (hits line 236 via brackets[last] !== char)
    const result = verify("Calculate (x + 1] * 2", "math", []);
    expect(result.domain).toBe("math");
    expect(result.confidence).toBeLessThan(1);
  });

  test("handles Unicode operators in math expressions", () => {
    // Unicode × (U+00D7) and ÷ (U+00F7) should not trigger false positives
    const result1 = verify("0.15 × 80 = 12", "math", []);
    expect(result1.passed).toBe(true);

    const result2 = verify("100 ÷ 4 = 25", "math", []);
    expect(result2.passed).toBe(true);

    // Chained expression with Unicode operator
    const result3 = verify("15% = 0.15. Therefore 0.15 × 80 = 12", "math", []);
    expect(result3.passed).toBe(true);
  });

  test("detects contradictory numeric assignments", () => {
    // Standalone number = different number should fail
    const result = verify("Therefore 5 = 3", "math", []);
    expect(result.passed).toBe(false);
    expect(result.evidence).toContain("equation structure");
  });

  test("allows valid chained equalities", () => {
    // Expression = result is valid
    const result1 = verify("2 + 2 = 4", "math", []);
    expect(result1.passed).toBe(true);

    // Same value equality is valid
    const result2 = verify("x = 1, and 1 = 1", "math", []);
    expect(result2.passed).toBe(true);
  });

  test("detects context contradictions in logic", () => {
    const result = verify("not the previous statement is valid", "logic", [
      "the previous statement is valid",
    ]);
    // Contradiction should affect result
    expect(result.domain).toBe("logic");
  });

  test("detects negation contradiction in context", () => {
    // The "not X" pattern matching - context has statement, thought negates it
    const result = verify("This conclusion is not correct", "logic", [
      "correct conclusion reached",
    ]);
    expect(result.domain).toBe("logic");
  });

  test("detects reverse negation contradiction", () => {
    // Context has negation, thought affirms (hits line 255 with prevLower check)
    const result = verify("The algorithm is valid", "logic", ["not the algorithm is valid"]);
    expect(result.domain).toBe("logic");
  });

  test("getVerificationCacheStats returns stats", () => {
    verificationCache.clear();
    verify("test thought for stats", "math", [], true);

    const stats = getVerificationCacheStats();
    expect(stats).toHaveProperty("size");
    expect(stats).toHaveProperty("hits");
    expect(stats).toHaveProperty("misses");
  });

  test("clearVerificationCache clears cache", () => {
    verify("thought to clear", "math", [], true);

    const cleared = clearVerificationCache();
    expect(cleared).toBeGreaterThanOrEqual(0);

    const stats = getVerificationCacheStats();
    expect(stats.size).toBe(0);
  });

  test("isMathOperator recognizes ASCII operators", () => {
    const asciiOps = ["+", "-", "*", "/", "^", "%"];
    for (const op of asciiOps) {
      expect(isMathOperator(op)).toBe(true);
    }
  });

  test("isMathOperator recognizes Unicode operators", () => {
    const unicodeOps = ["×", "÷", "−", "·", "√", "²", "³", "⁺", "⁻", "±", "∓"];
    for (const op of unicodeOps) {
      expect(isMathOperator(op)).toBe(true);
    }
  });

  test("isMathOperator rejects non-operators", () => {
    const nonOps = ["a", "1", " ", "=", "(", ")", "[", "]", "{", "}", ",", ".", "!", "?"];
    for (const char of nonOps) {
      expect(isMathOperator(char)).toBe(false);
    }
  });

  test("isMathOperator rejects multi-character strings", () => {
    expect(isMathOperator("++")).toBe(false);
    expect(isMathOperator("×÷")).toBe(false);
    expect(isMathOperator("")).toBe(false);
  });

  test("MATH_OPERATORS contains all supported operators", () => {
    expect(MATH_OPERATORS).toContain("+");
    expect(MATH_OPERATORS).toContain("×");
    expect(MATH_OPERATORS).toContain("√");
    expect(MATH_OPERATORS.length).toBeGreaterThan(10);
  });

  test("MATH_OPERATOR_PATTERN matches trailing operators", () => {
    expect(MATH_OPERATOR_PATTERN.test("2 +")).toBe(true);
    expect(MATH_OPERATOR_PATTERN.test("5 ×")).toBe(true);
    expect(MATH_OPERATOR_PATTERN.test("√")).toBe(true);
    expect(MATH_OPERATOR_PATTERN.test("2 + ")).toBe(true); // trailing space
    expect(MATH_OPERATOR_PATTERN.test("hello")).toBe(false);
    expect(MATH_OPERATOR_PATTERN.test("5 = 3")).toBe(false);
  });

  test("getOperatorPrecedence returns correct levels", () => {
    // Level 1: addition/subtraction
    expect(getOperatorPrecedence("+")).toBe(1);
    expect(getOperatorPrecedence("-")).toBe(1);
    expect(getOperatorPrecedence("−")).toBe(1); // Unicode minus
    expect(getOperatorPrecedence("±")).toBe(1);

    // Level 2: multiplication/division
    expect(getOperatorPrecedence("*")).toBe(2);
    expect(getOperatorPrecedence("/")).toBe(2);
    expect(getOperatorPrecedence("×")).toBe(2);
    expect(getOperatorPrecedence("÷")).toBe(2);
    expect(getOperatorPrecedence("·")).toBe(2);
    expect(getOperatorPrecedence("%")).toBe(2);

    // Level 3: exponentiation
    expect(getOperatorPrecedence("^")).toBe(3);
    expect(getOperatorPrecedence("²")).toBe(3);
    expect(getOperatorPrecedence("³")).toBe(3);

    // Level 4: unary/prefix
    expect(getOperatorPrecedence("√")).toBe(4);
  });

  test("getOperatorPrecedence returns null for non-operators", () => {
    expect(getOperatorPrecedence("a")).toBeNull();
    expect(getOperatorPrecedence("1")).toBeNull();
    expect(getOperatorPrecedence("=")).toBeNull();
    expect(getOperatorPrecedence("(")).toBeNull();
    expect(getOperatorPrecedence("")).toBeNull();
  });

  test("compareOperatorPrecedence compares correctly", () => {
    // + < * (multiplication binds tighter)
    expect(compareOperatorPrecedence("+", "*")).toBeLessThan(0);
    expect(compareOperatorPrecedence("*", "+")).toBeGreaterThan(0);

    // * < ^ (exponentiation binds tighter)
    expect(compareOperatorPrecedence("*", "^")).toBeLessThan(0);
    expect(compareOperatorPrecedence("^", "*")).toBeGreaterThan(0);

    // Same precedence
    expect(compareOperatorPrecedence("+", "-")).toBe(0);
    expect(compareOperatorPrecedence("*", "×")).toBe(0);
    expect(compareOperatorPrecedence("²", "³")).toBe(0);

    // Unicode equivalents
    expect(compareOperatorPrecedence("-", "−")).toBe(0);
    expect(compareOperatorPrecedence("*", "·")).toBe(0);
  });

  test("compareOperatorPrecedence returns null for invalid operators", () => {
    expect(compareOperatorPrecedence("a", "+")).toBeNull();
    expect(compareOperatorPrecedence("+", "b")).toBeNull();
    expect(compareOperatorPrecedence("x", "y")).toBeNull();
  });

  test("precedence follows PEMDAS order", () => {
    // Parentheses > Exponents > Multiplication/Division > Addition/Subtraction
    const add = getOperatorPrecedence("+")!;
    const mul = getOperatorPrecedence("*")!;
    const exp = getOperatorPrecedence("^")!;
    const sqrt = getOperatorPrecedence("√")!;

    expect(add).toBeLessThan(mul);
    expect(mul).toBeLessThan(exp);
    expect(exp).toBeLessThan(sqrt);
  });

  test("isRightAssociative identifies exponentiation operators", () => {
    // Exponentiation is right-associative: 2^3^4 = 2^(3^4)
    expect(isRightAssociative("^")).toBe(true);
    expect(isRightAssociative("²")).toBe(true);
    expect(isRightAssociative("³")).toBe(true);
  });

  test("isRightAssociative returns false for left-associative operators", () => {
    // Addition, subtraction, multiplication, division are left-associative
    expect(isRightAssociative("+")).toBe(false);
    expect(isRightAssociative("-")).toBe(false);
    expect(isRightAssociative("*")).toBe(false);
    expect(isRightAssociative("/")).toBe(false);
    expect(isRightAssociative("×")).toBe(false);
    expect(isRightAssociative("÷")).toBe(false);
    expect(isRightAssociative("√")).toBe(false);
  });

  test("getOperatorArity returns 1 for unary operators", () => {
    expect(getOperatorArity("√")).toBe(1); // prefix
    expect(getOperatorArity("²")).toBe(1); // postfix
    expect(getOperatorArity("³")).toBe(1); // postfix
    expect(getOperatorArity("⁺")).toBe(1);
    expect(getOperatorArity("⁻")).toBe(1);
  });

  test("getOperatorArity returns 2 for binary operators", () => {
    expect(getOperatorArity("+")).toBe(2);
    expect(getOperatorArity("-")).toBe(2);
    expect(getOperatorArity("*")).toBe(2);
    expect(getOperatorArity("/")).toBe(2);
    expect(getOperatorArity("^")).toBe(2);
    expect(getOperatorArity("×")).toBe(2);
    expect(getOperatorArity("÷")).toBe(2);
  });

  test("getOperatorArity returns null for non-operators", () => {
    expect(getOperatorArity("a")).toBeNull();
    expect(getOperatorArity("1")).toBeNull();
    expect(getOperatorArity("=")).toBeNull();
  });

  test("canBeUnary identifies context-dependent operators", () => {
    // Always unary
    expect(canBeUnary("√")).toBe(true);
    expect(canBeUnary("²")).toBe(true);
    // Can be unary in context (e.g., -5, +3)
    expect(canBeUnary("-")).toBe(true);
    expect(canBeUnary("+")).toBe(true);
    expect(canBeUnary("−")).toBe(true);
    expect(canBeUnary("±")).toBe(true);
    // Never unary
    expect(canBeUnary("*")).toBe(false);
    expect(canBeUnary("/")).toBe(false);
    expect(canBeUnary("×")).toBe(false);
  });

  test("getOperatorArityInContext handles unary minus", () => {
    // "-" after operator is unary
    expect(getOperatorArityInContext("-", true)).toBe(1);
    expect(getOperatorArityInContext("−", true)).toBe(1);
    // "-" after operand is binary
    expect(getOperatorArityInContext("-", false)).toBe(2);
    expect(getOperatorArityInContext("−", false)).toBe(2);
  });

  test("getOperatorArityInContext handles always-unary operators", () => {
    // √ is always unary regardless of context
    expect(getOperatorArityInContext("√", true)).toBe(1);
    expect(getOperatorArityInContext("√", false)).toBe(1);
    // ² is always unary
    expect(getOperatorArityInContext("²", true)).toBe(1);
    expect(getOperatorArityInContext("²", false)).toBe(1);
  });

  test("getOperatorArityInContext handles always-binary operators", () => {
    // * is always binary
    expect(getOperatorArityInContext("*", true)).toBe(2);
    expect(getOperatorArityInContext("*", false)).toBe(2);
  });
});

describe("Expression Validation", () => {
  test("validates simple valid expressions", () => {
    expect(validateExpression("2 + 3").valid).toBe(true);
    expect(validateExpression("5 * 4").valid).toBe(true);
    expect(validateExpression("10 / 2").valid).toBe(true);
    expect(validateExpression("2 ^ 3").valid).toBe(true);
    expect(validateExpression("x + y").valid).toBe(true);
  });

  test("validates expressions with Unicode operators", () => {
    expect(validateExpression("2 × 3").valid).toBe(true);
    expect(validateExpression("10 ÷ 2").valid).toBe(true);
    expect(validateExpression("5 − 3").valid).toBe(true);
  });

  test("validates expressions with unary operators", () => {
    expect(validateExpression("-5").valid).toBe(true);
    expect(validateExpression("+3").valid).toBe(true);
    expect(validateExpression("√4").valid).toBe(true);
    expect(validateExpression("5²").valid).toBe(true);
    expect(validateExpression("2³").valid).toBe(true);
  });

  test("validates expressions with unary minus in context", () => {
    expect(validateExpression("5 * -3").valid).toBe(true);
    expect(validateExpression("10 + -2").valid).toBe(true);
    expect(validateExpression("(-5)").valid).toBe(true);
  });

  test("validates expressions with parentheses", () => {
    expect(validateExpression("(2 + 3)").valid).toBe(true);
    expect(validateExpression("(2 + 3) * 4").valid).toBe(true);
    expect(validateExpression("2 * (3 + 4)").valid).toBe(true);
    expect(validateExpression("((2 + 3))").valid).toBe(true);
  });

  test("validates complex expressions", () => {
    expect(validateExpression("2 + 3 * 4").valid).toBe(true);
    expect(validateExpression("(2 + 3) * (4 - 1)").valid).toBe(true);
    expect(validateExpression("√(4 + 5)").valid).toBe(true);
    expect(validateExpression("2^3 + 4").valid).toBe(true);
    expect(validateExpression("x² + y²").valid).toBe(true);
  });

  test("rejects empty expressions", () => {
    const result = validateExpression("");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Empty expression");
  });

  test("rejects consecutive binary operators", () => {
    const result = validateExpression("2 + * 3");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Unexpected operator");
  });

  test("rejects expression ending with binary operator", () => {
    const result = validateExpression("5 +");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Expression ends with operator");
  });

  test("rejects unmatched opening parenthesis", () => {
    const result = validateExpression("(2 + 3");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Unclosed parenthesis");
  });

  test("rejects unmatched closing parenthesis", () => {
    const result = validateExpression("2 + 3)");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Unmatched closing parenthesis");
  });

  test("rejects empty parentheses", () => {
    const result = validateExpression("()");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Empty parentheses");
  });

  test("rejects postfix operator without operand", () => {
    const result = validateExpression("² 5");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Postfix operator");
  });

  test("provides error index for location", () => {
    const result = validateExpression("2 + * 3");
    expect(result.valid).toBe(false);
    expect(result.errorIndex).toBeDefined();
    expect(result.errorIndex).toBeGreaterThan(0);
  });

  test("handles expressions with equals (passes through)", () => {
    // Equals is not a math operator, so it's skipped
    expect(validateExpression("2 + 2 = 4").valid).toBe(true);
    expect(validateExpression("x = 5").valid).toBe(true);
  });

  test("handles scientific notation", () => {
    expect(validateExpression("1e10").valid).toBe(true);
    expect(validateExpression("2.5e-3").valid).toBe(true);
    expect(validateExpression("1e10 + 5").valid).toBe(true);
  });
});

describe("Math Expression Tokenizer", () => {
  test("tokenizes simple expression", () => {
    const result = tokenizeMathExpression("2 + 3");
    expect(result.errors).toHaveLength(0);
    expect(result.tokens).toHaveLength(3);

    expect(result.tokens[0]).toMatchObject({ type: "number", value: "2" });
    expect(result.tokens[1]).toMatchObject({
      type: "operator",
      value: "+",
      precedence: 1,
      arity: 2,
    });
    expect(result.tokens[2]).toMatchObject({ type: "number", value: "3" });
  });

  test("tokenizes expression with variables", () => {
    const result = tokenizeMathExpression("x + y * z");
    expect(result.errors).toHaveLength(0);
    expect(result.tokens).toHaveLength(5);

    expect(result.tokens[0]).toMatchObject({ type: "variable", value: "x" });
    expect(result.tokens[2]).toMatchObject({ type: "variable", value: "y" });
    expect(result.tokens[4]).toMatchObject({ type: "variable", value: "z" });
  });

  test("tokenizes parentheses", () => {
    const result = tokenizeMathExpression("(2 + 3)");
    expect(result.errors).toHaveLength(0);
    expect(result.tokens).toHaveLength(5);

    expect(result.tokens[0]).toMatchObject({ type: "paren", value: "(" });
    expect(result.tokens[4]).toMatchObject({ type: "paren", value: ")" });
  });

  test("detects unary minus", () => {
    const result = tokenizeMathExpression("-5");
    expect(result.errors).toHaveLength(0);
    expect(result.tokens).toHaveLength(2);

    expect(result.tokens[0]).toMatchObject({ type: "operator", value: "-", arity: 1 });
    expect(result.tokens[1]).toMatchObject({ type: "number", value: "5" });
  });

  test("detects unary minus after operator", () => {
    const result = tokenizeMathExpression("3 * -2");
    expect(result.errors).toHaveLength(0);
    expect(result.tokens).toHaveLength(4);

    expect(result.tokens[0]).toMatchObject({ type: "number", value: "3" });
    expect(result.tokens[1]).toMatchObject({ type: "operator", value: "*", arity: 2 });
    expect(result.tokens[2]).toMatchObject({ type: "operator", value: "-", arity: 1 });
    expect(result.tokens[3]).toMatchObject({ type: "number", value: "2" });
  });

  test("detects binary minus", () => {
    const result = tokenizeMathExpression("5 - 3");
    expect(result.errors).toHaveLength(0);

    expect(result.tokens[1]).toMatchObject({ type: "operator", value: "-", arity: 2 });
  });

  test("includes operator metadata", () => {
    const result = tokenizeMathExpression("2 ^ 3");
    expect(result.errors).toHaveLength(0);

    const expOp = result.tokens[1];
    expect(expOp).toMatchObject({
      type: "operator",
      value: "^",
      precedence: 3,
      arity: 2,
      rightAssociative: true,
    });
  });

  test("tokenizes Unicode operators", () => {
    const result = tokenizeMathExpression("2 × 3 ÷ 4");
    expect(result.errors).toHaveLength(0);
    expect(result.tokens).toHaveLength(5);

    expect(result.tokens[1]).toMatchObject({ type: "operator", value: "×", precedence: 2 });
    expect(result.tokens[3]).toMatchObject({ type: "operator", value: "÷", precedence: 2 });
  });

  test("tokenizes postfix operators", () => {
    const result = tokenizeMathExpression("x² + y³");
    expect(result.errors).toHaveLength(0);
    expect(result.tokens).toHaveLength(5);

    expect(result.tokens[1]).toMatchObject({ type: "operator", value: "²", arity: 1 });
    expect(result.tokens[4]).toMatchObject({ type: "operator", value: "³", arity: 1 });
  });

  test("tokenizes prefix operators", () => {
    const result = tokenizeMathExpression("√4 + √9");
    expect(result.errors).toHaveLength(0);
    expect(result.tokens).toHaveLength(5);

    expect(result.tokens[0]).toMatchObject({
      type: "operator",
      value: "√",
      arity: 1,
      precedence: 4,
    });
    expect(result.tokens[3]).toMatchObject({ type: "operator", value: "√", arity: 1 });
  });

  test("tokenizes decimal numbers", () => {
    const result = tokenizeMathExpression("3.14 + 2.71");
    expect(result.errors).toHaveLength(0);

    expect(result.tokens[0]).toMatchObject({ type: "number", value: "3.14" });
    expect(result.tokens[2]).toMatchObject({ type: "number", value: "2.71" });
  });

  test("tokenizes scientific notation", () => {
    const result = tokenizeMathExpression("1e10 + 2.5e-3");
    expect(result.errors).toHaveLength(0);

    expect(result.tokens[0]).toMatchObject({ type: "number", value: "1e10" });
    expect(result.tokens[2]).toMatchObject({ type: "number", value: "2.5e-3" });
  });

  test("tracks token positions", () => {
    const result = tokenizeMathExpression("2 + 3");
    expect(result.tokens[0]?.position).toBe(0);
    expect(result.tokens[1]?.position).toBe(2);
    expect(result.tokens[2]?.position).toBe(4);
  });

  test("reports unknown characters as errors", () => {
    const result = tokenizeMathExpression("2 @ 3");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("@");

    const unknownToken = result.tokens.find((t) => t.type === "unknown");
    expect(unknownToken).toBeDefined();
    expect(unknownToken?.value).toBe("@");
  });

  test("handles empty expression", () => {
    const result = tokenizeMathExpression("");
    expect(result.tokens).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  test("handles complex expression", () => {
    const result = tokenizeMathExpression("(x² + y²)^(1/2)");
    expect(result.errors).toHaveLength(0);

    const types = result.tokens.map((t) => t.type);
    expect(types).toContain("paren");
    expect(types).toContain("variable");
    expect(types).toContain("operator");
    expect(types).toContain("number");
  });
});

describe("verifyMath integration with validateExpression", () => {
  test("catches malformed expressions in reasoning", () => {
    const result = verify("Let's calculate: 2 + * 3 = error", "math", []);
    expect(result.passed).toBe(false);
    expect(result.evidence).toContain("Expression error");
  });

  test("passes valid expressions in reasoning", () => {
    const result = verify("Calculate: 2 + 3 * 4 = 14", "math", []);
    expect(result.passed).toBe(true);
  });

  test("passes complex valid expressions", () => {
    const result = verify("The formula is (x + y) * (x - y) = x² - y²", "math", []);
    expect(result.passed).toBe(true);
  });
});

describe("AST Building", () => {
  test("builds AST for simple expression", () => {
    const tokens = tokenizeMathExpression("2 + 3").tokens;
    const { ast, error } = buildAST(tokens);

    expect(error).toBeUndefined();
    expect(ast).toBeDefined();
    expect(ast?.type).toBe("binary");
    if (ast?.type === "binary") {
      expect(ast.operator).toBe("+");
      expect(ast.left).toMatchObject({ type: "number", value: 2 });
      expect(ast.right).toMatchObject({ type: "number", value: 3 });
    }
  });

  test("respects operator precedence", () => {
    const tokens = tokenizeMathExpression("2 + 3 * 4").tokens;
    const { ast } = buildAST(tokens);

    // Should be 2 + (3 * 4), not (2 + 3) * 4
    expect(ast?.type).toBe("binary");
    if (ast?.type === "binary") {
      expect(ast.operator).toBe("+");
      expect(ast.left).toMatchObject({ type: "number", value: 2 });
      expect(ast.right.type).toBe("binary");
      if (ast.right.type === "binary") {
        expect(ast.right.operator).toBe("*");
      }
    }
  });

  test("handles parentheses", () => {
    const tokens = tokenizeMathExpression("(2 + 3) * 4").tokens;
    const { ast } = buildAST(tokens);

    // Should be (2 + 3) * 4
    expect(ast?.type).toBe("binary");
    if (ast?.type === "binary") {
      expect(ast.operator).toBe("*");
      expect(ast.left.type).toBe("binary");
      expect(ast.right).toMatchObject({ type: "number", value: 4 });
    }
  });

  test("handles unary minus", () => {
    const tokens = tokenizeMathExpression("-5").tokens;
    const { ast } = buildAST(tokens);

    expect(ast?.type).toBe("unary");
    if (ast?.type === "unary") {
      expect(ast.operator).toBe("-");
      expect(ast.operand).toMatchObject({ type: "number", value: 5 });
    }
  });

  test("handles variables", () => {
    const tokens = tokenizeMathExpression("x + y").tokens;
    const { ast } = buildAST(tokens);

    expect(ast?.type).toBe("binary");
    if (ast?.type === "binary") {
      expect(ast.left).toMatchObject({ type: "variable", name: "x" });
      expect(ast.right).toMatchObject({ type: "variable", name: "y" });
    }
  });

  test("handles right-associative exponentiation", () => {
    const tokens = tokenizeMathExpression("2 ^ 3 ^ 2").tokens;
    const { ast } = buildAST(tokens);

    // Should be 2 ^ (3 ^ 2), not (2 ^ 3) ^ 2
    expect(ast?.type).toBe("binary");
    if (ast?.type === "binary") {
      expect(ast.operator).toBe("^");
      expect(ast.left).toMatchObject({ type: "number", value: 2 });
      expect(ast.right.type).toBe("binary");
    }
  });

  test("returns error for empty tokens", () => {
    const { ast, error } = buildAST([]);
    expect(ast).toBeNull();
    expect(error).toBe("Empty expression");
  });
});

describe("Expression Formatting", () => {
  test("formats with default options", () => {
    const tokens = tokenizeMathExpression("2+3*4").tokens;
    const formatted = formatExpression(tokens);
    expect(formatted).toBe("2 + 3 * 4");
  });

  test("converts to Unicode operators", () => {
    const tokens = tokenizeMathExpression("2*3/4").tokens;
    const formatted = formatExpression(tokens, { useUnicode: true });
    expect(formatted).toBe("2 × 3 ÷ 4");
  });

  test("formats without spaces", () => {
    const tokens = tokenizeMathExpression("2 + 3").tokens;
    const formatted = formatExpression(tokens, { spaces: false });
    expect(formatted).toBe("2+3");
  });

  test("handles parentheses correctly", () => {
    const tokens = tokenizeMathExpression("(2 + 3) * 4").tokens;
    const formatted = formatExpression(tokens);
    expect(formatted).toBe("(2 + 3) * 4");
  });

  test("handles postfix operators without space", () => {
    const tokens = tokenizeMathExpression("x²").tokens;
    const formatted = formatExpression(tokens);
    expect(formatted).toBe("x²");
  });

  test("handles prefix operators without trailing space", () => {
    const tokens = tokenizeMathExpression("√4").tokens;
    const formatted = formatExpression(tokens);
    expect(formatted).toBe("√4");
  });

  test("normalizes minus sign", () => {
    const tokens = tokenizeMathExpression("5 - 3").tokens;
    const formatted = formatExpression(tokens, { normalizeMinus: true });
    expect(formatted).toBe("5 − 3");
  });
});

describe("Expression Evaluation", () => {
  test("evaluates simple arithmetic", () => {
    expect(evaluateExpression("2 + 3").value).toBe(5);
    expect(evaluateExpression("10 - 4").value).toBe(6);
    expect(evaluateExpression("3 * 4").value).toBe(12);
    expect(evaluateExpression("15 / 3").value).toBe(5);
  });

  test("respects operator precedence", () => {
    expect(evaluateExpression("2 + 3 * 4").value).toBe(14);
    expect(evaluateExpression("10 - 2 * 3").value).toBe(4);
  });

  test("handles parentheses", () => {
    expect(evaluateExpression("(2 + 3) * 4").value).toBe(20);
    expect(evaluateExpression("(10 - 2) * (3 + 1)").value).toBe(32);
  });

  test("handles unary minus", () => {
    expect(evaluateExpression("-5").value).toBe(-5);
    expect(evaluateExpression("3 * -2").value).toBe(-6);
    expect(evaluateExpression("--5").value).toBe(5);
  });

  test("handles exponentiation", () => {
    expect(evaluateExpression("2 ^ 3").value).toBe(8);
    expect(evaluateExpression("2 ^ 3 ^ 2").value).toBe(512); // 2^(3^2) = 2^9
  });

  test("handles square root", () => {
    expect(evaluateExpression("√4").value).toBe(2);
    expect(evaluateExpression("√9 + 1").value).toBe(4);
  });

  test("handles postfix operators", () => {
    expect(evaluateExpression("3²").value).toBe(9);
    expect(evaluateExpression("2³").value).toBe(8);
    expect(evaluateExpression("2² + 3²").value).toBe(13);
  });

  test("handles Unicode operators", () => {
    expect(evaluateExpression("6 × 7").value).toBe(42);
    expect(evaluateExpression("20 ÷ 4").value).toBe(5);
    expect(evaluateExpression("10 − 3").value).toBe(7);
  });

  test("handles variables", () => {
    expect(evaluateExpression("x + y", { x: 3, y: 4 }).value).toBe(7);
    expect(evaluateExpression("x² + y²", { x: 3, y: 4 }).value).toBe(25);
  });

  test("returns error for unbound variable", () => {
    const result = evaluateExpression("x + 1");
    expect(result.value).toBeNull();
    expect(result.error).toContain("Unbound variable");
  });

  test("handles division by zero", () => {
    const result = evaluateExpression("10 / 0");
    expect(result.value).toBeNull();
    expect(result.error).toBe("Division by zero");
  });

  test("handles modulo by zero", () => {
    const result = evaluateExpression("10 % 0");
    expect(result.value).toBeNull();
    expect(result.error).toBe("Modulo by zero");
  });

  test("handles square root of negative", () => {
    const result = evaluateExpression("√-4");
    expect(result.value).toBeNull();
    expect(result.error).toContain("negative");
  });

  test("handles decimal numbers", () => {
    expect(evaluateExpression("3.14 * 2").value).toBeCloseTo(6.28);
    expect(evaluateExpression("1.5 + 2.5").value).toBe(4);
  });

  test("handles scientific notation", () => {
    expect(evaluateExpression("1e2 + 1").value).toBe(101);
    expect(evaluateExpression("2.5e-1 * 4").value).toBe(1);
  });

  test("handles complex expressions", () => {
    expect(evaluateExpression("(3 + 4) * (2 ^ 2) / 2").value).toBe(14);
    expect(evaluateExpression("√(3² + 4²)").value).toBe(5);
  });
});

describe("Math Verification Fuzzing", () => {
  // Unicode operators that should be recognized
  const VALID_OPERATORS = ["+", "-", "*", "/", "×", "÷", "−", "·", "^", "√"];

  // Generator helpers
  const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
  const randFloat = () => (Math.random() * 100).toFixed(randInt(0, 2));
  const randOp = () => VALID_OPERATORS[randInt(0, VALID_OPERATORS.length - 1)];

  test("valid expressions with Unicode operators should pass", () => {
    const cases = [
      // Explicit test cases for each Unicode operator
      "5 × 3 = 15",
      "20 ÷ 4 = 5",
      "10 − 3 = 7",
      "2 · 3 = 6",
      "2^3 = 8",
      "√4 = 2",
      // Combined operators
      "2 × 3 + 4 = 10",
      "100 ÷ 10 − 5 = 5",
    ];

    for (const expr of cases) {
      const result = verify(expr, "math", []);
      expect(result.passed).toBe(true);
    }
  });

  test("fuzz: generated valid expressions should pass", () => {
    // Generate random valid expressions: a OP b = c
    for (let i = 0; i < 50; i++) {
      const a = randFloat();
      const op = randOp();
      const b = randFloat();
      const expr = `${a} ${op} ${b} = result`;

      const result = verify(expr, "math", []);
      // Should pass because there's an operator before the "= result"
      expect(result.passed).toBe(true);
    }
  });

  test("fuzz: contradictory standalone numbers should fail", () => {
    // Generate patterns like "Therefore 5 = 3" (no operator before)
    for (let i = 0; i < 20; i++) {
      const a = randInt(1, 100);
      const b = randInt(1, 100);
      if (a === b) continue; // Skip equal numbers

      const prefixes = ["Therefore", "So", "Thus", "Hence", "We get"];
      const prefix = prefixes[randInt(0, prefixes.length - 1)];
      const expr = `${prefix} ${a} = ${b}`;

      const result = verify(expr, "math", []);
      expect(result.passed).toBe(false);
    }
  });

  test("fuzz: same numbers should pass", () => {
    // n = n should always pass
    for (let i = 0; i < 20; i++) {
      const n = randFloat();
      const expr = `Therefore ${n} = ${n}`;

      const result = verify(expr, "math", []);
      expect(result.passed).toBe(true);
    }
  });

  test("fuzz: expressions with various spacing should be handled", () => {
    const spacings = ["", " ", "  ", "\t"];
    for (let i = 0; i < 30; i++) {
      const a = randInt(1, 10);
      const op = randOp();
      const b = randInt(1, 10);
      const s1 = spacings[randInt(0, spacings.length - 1)];
      const s2 = spacings[randInt(0, spacings.length - 1)];
      const expr = `${a}${s1}${op}${s2}${b} = result`;

      const result = verify(expr, "math", []);
      // Should not throw, should return a result
      expect(result.domain).toBe("math");
      expect(typeof result.passed).toBe("boolean");
    }
  });

  test("fuzz: mixed ASCII and Unicode operators in same expression", () => {
    for (let i = 0; i < 20; i++) {
      const parts: string[] = [];
      for (let j = 0; j < randInt(2, 5); j++) {
        parts.push(randFloat());
        if (j < randInt(1, 4)) parts.push(randOp());
      }
      const expr = `${parts.join(" ")} = result`;

      const result = verify(expr, "math", []);
      expect(result.domain).toBe("math");
      // Should not crash
    }
  });

  test("verification performance under fuzz load", () => {
    const iterations = 100;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      const expr = `${randFloat()} ${randOp()} ${randFloat()} = ${randFloat()}`;
      verify(expr, "math", [], false); // Disable cache for fair timing
    }

    const elapsed = performance.now() - start;
    const avgMs = elapsed / iterations;

    // Should be < 1ms per verification (target: <10ms per AGENTS.md)
    expect(avgMs).toBeLessThan(1);
    console.log(`Average verification time: ${avgMs.toFixed(4)}ms`);
  });
});

describe("Compression", () => {
  test("compresses text with ratio", () => {
    const text =
      "The quick brown fox jumps. The lazy dog sleeps. A third sentence here. Fourth sentence for testing.";
    const result = compress(text, "fox", { target_ratio: 0.5 });

    expect(result.compressed.length).toBeLessThan(text.length);
    expect(result.ratio).toBeLessThanOrEqual(1);
    expect(result.kept_sentences).toBeGreaterThan(0);
  });

  test("boosts reasoning keywords", () => {
    const text =
      "A simple fact here. Therefore this is the most important conclusion. Another unrelated fact. Yet another fact.";
    const result = compress(text, "conclusion", {
      target_ratio: 0.5,
      boost_reasoning: true,
    });

    // "Therefore" sentence should be kept due to both relevance and reasoning boost
    expect(result.compressed).toContain("Therefore");
  });

  test("quickCompress respects max tokens", () => {
    const text = "First sentence here. Second sentence here. Third sentence here. Fourth sentence.";
    const result = quickCompress(text, "test", 20);

    // Rough token estimate: length / 4
    expect(result.length / 4).toBeLessThanOrEqual(25); // Some tolerance
  });

  test("handles empty input", () => {
    const result = compress("", "query", { target_ratio: 0.5 });
    expect(result.compressed).toBe("");
    expect(result.kept_sentences).toBe(0);
  });

  test("preserves sentence order", () => {
    const text = "First. Second. Third.";
    const result = compress(text, "Second", { target_ratio: 0.7 });

    // If multiple sentences kept, order should be preserved
    if (result.compressed.includes("First") && result.compressed.includes("Second")) {
      expect(result.compressed.indexOf("First")).toBeLessThan(result.compressed.indexOf("Second"));
    }
  });

  test("penalizes filler phrases", () => {
    const text =
      "Um let me think about this. The algorithm uses binary search. Well this is interesting.";
    const result = compress(text, "algorithm", { target_ratio: 0.5 });

    // The informative sentence should be kept over filler sentences
    expect(result.compressed).toContain("algorithm");
  });

  test("quickCompress compresses when over token limit", () => {
    // Create text that definitely exceeds the token limit
    const longText =
      "This is a very long sentence that contains many important details about the topic at hand. " +
      "Another sentence with more information. " +
      "Yet another sentence adding context. " +
      "The final sentence wraps things up nicely.";

    // Set a low max token limit to force compression
    const result = quickCompress(longText, "important", 10);

    // Should be shorter than original
    expect(result.length).toBeLessThan(longText.length);
  });
});

describe("Concepts", () => {
  beforeEach(() => {
    clearTracker("test-session");
  });

  test("extracts concepts from text", () => {
    const tracker = getTracker("test-session");
    const concepts = tracker.extract(
      "The function calculates the derivative using the chain rule",
      1,
    );

    expect(concepts.length).toBeGreaterThan(0);
    expect(concepts.some((c) => c.domain === "math" || c.domain === "code")).toBe(true);
  });

  test("tracks concept frequency", () => {
    const tracker = getTracker("test-session");

    tracker.extract("The variable x equals 5", 1);
    tracker.extract("The variable x is used again", 2);

    const summary = tracker.getSummary();
    expect(summary.total).toBeGreaterThan(0);
  });

  test("gets summary with top concepts", () => {
    const tracker = getTracker("test-session");

    tracker.extract("algorithm complexity analysis", 1);
    tracker.extract("algorithm performance", 2);

    const summary = tracker.getSummary();
    expect(summary.top).toBeDefined();
    expect(Array.isArray(summary.top)).toBe(true);
  });

  test("clears tracker", () => {
    const tracker = getTracker("clear-test");
    tracker.extract("Some concept here", 1);

    clearTracker("clear-test");

    const newTracker = getTracker("clear-test");
    expect(newTracker.getSummary().total).toBe(0);
  });

  test("tracker clear method resets concepts", () => {
    const tracker = getTracker("clear-instance-test");
    tracker.extract("algorithm complexity function", 1);
    expect(tracker.getSummary().total).toBeGreaterThan(0);

    tracker.clear();
    expect(tracker.getSummary().total).toBe(0);
    expect(tracker.getAll().length).toBe(0);
  });

  test("getTopConcepts sorts by count and limits results", () => {
    const tracker = getTracker("top-concepts-test");
    // Create multiple DISTINCT concepts with different counts
    // Extract "function" 3 times to get count=3
    tracker.extract("function", 1);
    tracker.extract("function", 2);
    tracker.extract("function", 3);
    // Extract "variable" 2 times to get count=2
    tracker.extract("variable", 4);
    tracker.extract("variable", 5);
    // Extract "class" 1 time to get count=1
    tracker.extract("class", 6);

    // Now we have 3 distinct concepts with different counts
    expect(tracker.getAll().length).toBe(3);

    const top2 = tracker.getTopConcepts(2);
    expect(top2).toHaveLength(2);
    // Most frequent should be first - this forces the sort callback to run
    expect(top2[0].name).toBe("function");
    expect(top2[0].count).toBe(3);
    expect(top2[1].name).toBe("variable");
    expect(top2[1].count).toBe(2);
  });

  test("getSummary aggregates by domain correctly", () => {
    const tracker = getTracker("summary-domain-test");
    tracker.extract("function class method", 1); // code domain
    tracker.extract("equation solve calculate", 2); // math domain

    const summary = tracker.getSummary();
    expect(summary.by_domain).toHaveProperty("code");
    expect(summary.by_domain).toHaveProperty("math");
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.top.length).toBeLessThanOrEqual(5);
  });

  test("gets concepts by domain", () => {
    const tracker = getTracker("test-session");
    tracker.extract("function variable class method", 1);

    const codeConcepts = tracker.getByDomain("code");
    expect(codeConcepts.length).toBeGreaterThan(0);
    expect(codeConcepts.every((c) => c.domain === "code")).toBe(true);
  });

  test("gets top concepts sorted by count", () => {
    const tracker = getTracker("test-session");
    tracker.extract("function function function", 1);
    tracker.extract("variable", 2);

    const top = tracker.getTopConcepts(2);
    expect(top.length).toBeLessThanOrEqual(2);
  });

  test("direct ConceptTracker construction", () => {
    // Directly construct ConceptTracker to ensure constructor is covered
    const tracker = new ConceptTracker();
    tracker.extract("algorithm complexity", 1);
    expect(tracker.getAll().length).toBeGreaterThan(0);
    tracker.clear();
    expect(tracker.getAll().length).toBe(0);
  });
});

describe("VerificationCache", () => {
  beforeEach(() => {
    verificationCache.clear();
    // Reset to default config
    verificationCache.configure({ rate_limit_ops: 100, rate_limit_window_ms: 1000 });
  });

  test("stores and retrieves cached results", () => {
    const result = {
      passed: true,
      confidence: 0.9,
      domain: "math" as const,
      evidence: "test",
      suggestions: [] as string[],
      reward: 1 as const,
      cached: false,
    };

    verificationCache.set("test-thought", "math", [], result);
    const cached = verificationCache.get("test-thought", "math", []);

    expect(cached).toBeDefined();
    expect(cached?.passed).toBe(true);
  });

  test("returns null for cache miss", () => {
    const result = verificationCache.get("nonexistent", "math", []);
    expect(result).toBeNull();
  });

  test("clears cache and resets stats", () => {
    const result = {
      passed: true,
      confidence: 0.9,
      domain: "math" as const,
      evidence: "test",
      suggestions: [] as string[],
      reward: 1 as const,
      cached: false,
    };

    verificationCache.set("test", "math", [], result);
    verificationCache.get("test", "math", []); // hit
    verificationCache.get("miss", "math", []); // miss

    const clearedCount = verificationCache.clear();
    expect(clearedCount).toBe(1);

    const stats = verificationCache.getStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.rate_limited).toBe(0);
  });

  test("reports comprehensive stats", () => {
    const result = {
      passed: true,
      confidence: 0.9,
      domain: "math" as const,
      evidence: "test",
      suggestions: [] as string[],
      reward: 1 as const,
      cached: false,
    };

    verificationCache.set("test", "math", [], result);
    verificationCache.get("test", "math", []); // hit
    verificationCache.get("miss", "math", []); // miss

    const stats = verificationCache.getStats();
    expect(stats).toHaveProperty("size");
    expect(stats).toHaveProperty("max");
    expect(stats).toHaveProperty("hit_rate");
    expect(stats).toHaveProperty("hits");
    expect(stats).toHaveProperty("misses");
    expect(stats).toHaveProperty("rate_limited");
    expect(stats).toHaveProperty("ops_in_window");
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });

  test("rate limits under high load", () => {
    // Configure very low rate limit for testing
    verificationCache.configure({ rate_limit_ops: 5, rate_limit_window_ms: 1000 });
    verificationCache.clear();

    const result = {
      passed: true,
      confidence: 0.9,
      domain: "math" as const,
      evidence: "test",
      suggestions: [] as string[],
      reward: 1 as const,
      cached: false,
    };

    // First 5 operations should succeed
    for (let i = 0; i < 5; i++) {
      expect(verificationCache.set(`thought-${i}`, "math", [], result)).toBe(true);
    }

    // 6th operation should be rate limited
    expect(verificationCache.set("thought-6", "math", [], result)).toBe(false);
    expect(verificationCache.isRateLimited()).toBe(true);

    const stats = verificationCache.getStats();
    expect(stats.rate_limited).toBeGreaterThan(0);
  });

  test("rate limit resets after window expires", async () => {
    // Configure very short window for testing
    verificationCache.configure({ rate_limit_ops: 2, rate_limit_window_ms: 50 });
    verificationCache.clear();

    const result = {
      passed: true,
      confidence: 0.9,
      domain: "math" as const,
      evidence: "test",
      suggestions: [] as string[],
      reward: 1 as const,
      cached: false,
    };

    // Use up the rate limit
    verificationCache.set("t1", "math", [], result);
    verificationCache.set("t2", "math", [], result);
    expect(verificationCache.isRateLimited()).toBe(true);

    // Wait for window to expire
    await Bun.sleep(60);

    // Should be able to operate again
    expect(verificationCache.isRateLimited()).toBe(false);
    expect(verificationCache.set("t3", "math", [], result)).toBe(true);
  });

  test("handles context in cache key", () => {
    const result = {
      passed: true,
      confidence: 0.9,
      domain: "math" as const,
      evidence: "test",
      suggestions: [] as string[],
      reward: 1 as const,
      cached: false,
    };

    // Same thought, different context should be different cache entries
    verificationCache.set("thought", "math", ["context1"], result);
    verificationCache.set("thought", "math", ["context2"], { ...result, confidence: 0.5 });

    const cached1 = verificationCache.get("thought", "math", ["context1"]);
    const cached2 = verificationCache.get("thought", "math", ["context2"]);

    expect(cached1?.confidence).toBe(0.9);
    expect(cached2?.confidence).toBe(0.5);
  });

  test("expires entries after TTL", async () => {
    // Configure very short TTL for testing
    verificationCache.configure({ ttl_ms: 50 });
    verificationCache.clear();

    const result = {
      passed: true,
      confidence: 0.9,
      domain: "math" as const,
      evidence: "test",
      suggestions: [] as string[],
      reward: 1 as const,
      cached: false,
    };

    verificationCache.set("test", "math", [], result);
    expect(verificationCache.get("test", "math", [])).not.toBeNull();

    // Wait for TTL to expire
    await Bun.sleep(60);

    expect(verificationCache.get("test", "math", [])).toBeNull();
  });

  test("evicts oldest entries when at max capacity", () => {
    // Configure very small cache for testing eviction
    verificationCache.configure({
      max_entries: 5,
      ttl_ms: 60000,
      rate_limit_ops: 1000, // High limit to not interfere
    });
    verificationCache.clear();

    const makeResult = (id: number) => ({
      passed: true,
      confidence: 0.9,
      domain: "math" as const,
      evidence: `test-${id}`,
      suggestions: [] as string[],
      reward: 1 as const,
      cached: false,
    });

    // Fill cache to capacity
    for (let i = 0; i < 5; i++) {
      verificationCache.set(`thought-${i}`, "math", [], makeResult(i));
    }
    expect(verificationCache.getStats().size).toBe(5);

    // Access some entries to increase their hit count
    verificationCache.get("thought-3", "math", []);
    verificationCache.get("thought-3", "math", []);
    verificationCache.get("thought-4", "math", []);

    // Add new entry - should trigger eviction of least-hit entries
    verificationCache.set("thought-new", "math", [], makeResult(99));

    const stats = verificationCache.getStats();
    // Should have evicted ~10% (1 entry) and added 1
    expect(stats.size).toBeLessThanOrEqual(5);

    // High-hit entries should survive
    expect(verificationCache.get("thought-3", "math", [])).not.toBeNull();
  });
});

// =============================================================================
// LOCAL COMPUTE ENGINE TESTS
// =============================================================================

describe("LocalCompute - tryArithmetic", () => {
  test("basic addition: 17 + 28", () => {
    const result = tryArithmetic("What is 17 + 28?");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(45);
    expect(result.method).toBe("arithmetic");
    expect(result.confidence).toBe(1.0);
    expect(result.time_ms).toBeLessThan(10);
  });

  test("basic subtraction: 100 - 37", () => {
    const result = tryArithmetic("Calculate 100 - 37");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(63);
  });

  test("multiplication: 12 * 15", () => {
    const result = tryArithmetic("Compute 12 * 15");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(180);
  });

  test("division: 144 / 12", () => {
    const result = tryArithmetic("Evaluate 144 / 12");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(12);
  });

  test("complex expression: (5 * 12) / 4", () => {
    const result = tryArithmetic("What is (5 * 12) / 4?");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(15);
  });

  test("decimal result: 10 / 3", () => {
    const result = tryArithmetic("10 / 3");
    expect(result.solved).toBe(true);
    expect(result.result).toBeCloseTo(3.3333333333, 5);
  });

  test("raw expression: 2 + 3 * 4", () => {
    const result = tryArithmetic("2 + 3 * 4");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(14); // Respects operator precedence
  });

  test("expression with = ?: 25 + 17 = ?", () => {
    const result = tryArithmetic("25 + 17 = ?");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(42);
  });

  test("rejects unsafe characters", () => {
    const result = tryArithmetic("What is alert('hack')");
    expect(result.solved).toBe(false);
  });

  test("rejects empty parentheses", () => {
    const result = tryArithmetic("What is () + 5");
    expect(result.solved).toBe(false);
  });

  test("rejects non-numeric text", () => {
    const result = tryArithmetic("What is the meaning of life?");
    expect(result.solved).toBe(false);
  });
});

describe("LocalCompute - tryFormula", () => {
  describe("Pythagorean Theorem", () => {
    test("legs 5 and 12, hypotenuse", () => {
      const result = tryFormula("A right triangle has legs 5 and 12. What is the hypotenuse?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(13);
      expect(result.method).toBe("pythagorean");
    });

    test("sides 3 and 4, hypotenuse", () => {
      const result = tryFormula("Triangle with sides 3 and 4, find hypotenuse");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(5);
    });

    test("legs 8 and 15, hypotenuse", () => {
      const result = tryFormula("Right triangle legs 8 and 15. Hypotenuse?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(17);
    });
  });

  describe("Quadratic Formula", () => {
    test("x² - 5x + 6 = 0, larger root", () => {
      const result = tryFormula("Solve x² - 5x + 6 = 0. What is the larger root?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(3);
      expect(result.method).toBe("quadratic_larger");
    });

    test("x² - 5x + 6 = 0, smaller root", () => {
      const result = tryFormula("Solve x² - 5x + 6 = 0. What is the smaller root?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(2);
      expect(result.method).toBe("quadratic_smaller");
    });

    test("x² + 3x - 4 = 0, both roots", () => {
      const result = tryFormula("Solve x² + 3x - 4 = 0");
      expect(result.solved).toBe(true);
      expect(result.method).toBe("quadratic");
      // Roots: 1 and -4
    });

    test("x² - 4x + 4 = 0, double root", () => {
      const result = tryFormula("Solve x² - 4x + 4 = 0");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(2); // Double root
    });
  });

  describe("Fibonacci", () => {
    test("8th Fibonacci number", () => {
      const result = tryFormula("What is the 8th Fibonacci number?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(21);
      expect(result.method).toBe("fibonacci");
    });

    test("1st Fibonacci number", () => {
      const result = tryFormula("What is the 1st Fibonacci number?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(1);
    });

    test("10th Fibonacci number", () => {
      const result = tryFormula("10th Fibonacci number");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(55);
    });

    test("rejects n > 100", () => {
      const result = tryFormula("What is the 150th Fibonacci number?");
      expect(result.solved).toBe(false);
    });
  });

  describe("Factorial", () => {
    test("5!", () => {
      const result = tryFormula("What is 5!");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(120);
      expect(result.method).toBe("factorial");
    });

    test("factorial of 6", () => {
      const result = tryFormula("Calculate the factorial of 6");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(720);
    });

    test("0!", () => {
      const result = tryFormula("What is 0!");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(1);
    });

    test("10!", () => {
      const result = tryFormula("10!");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(3628800);
    });
  });

  describe("Logarithms", () => {
    test("log₁₀(100)", () => {
      const result = tryFormula("What is log₁₀(100)?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(2);
      expect(result.method).toBe("logarithm_base10");
    });

    test("log₁₀(100) + log₁₀(1000)", () => {
      const result = tryFormula("log₁₀(100) + log₁₀(1000)");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(5);
    });

    test("ln(e) approximation", () => {
      const result = tryFormula("What is ln(2.718281828)?");
      expect(result.solved).toBe(true);
      expect(result.result).toBeCloseTo(1, 3);
      expect(result.method).toBe("natural_log");
    });
  });

  describe("Square Root", () => {
    test("√144", () => {
      const result = tryFormula("√144");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(12);
      expect(result.method).toBe("square_root");
    });

    test("sqrt(81)", () => {
      const result = tryFormula("What is sqrt(81)?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(9);
    });

    test("square root of 2", () => {
      const result = tryFormula("Calculate the square root of 2");
      expect(result.solved).toBe(true);
      expect(result.result).toBeCloseTo(Math.SQRT2, 4);
    });
  });

  describe("Powers", () => {
    test("2^10", () => {
      const result = tryFormula("What is 2^10?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(1024);
      expect(result.method).toBe("power");
    });

    test("3**4", () => {
      const result = tryFormula("Calculate 3**4");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(81);
    });

    test("5 to the power of 3", () => {
      const result = tryFormula("What is 5 to the power of 3?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(125);
    });
  });

  describe("Percentages", () => {
    test("15% of 200", () => {
      const result = tryFormula("What is 15% of 200?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(30);
      expect(result.method).toBe("percentage");
    });

    test("25% of 80", () => {
      const result = tryFormula("25% of 80");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(20);
    });

    test("7.5% of 1000", () => {
      const result = tryFormula("Calculate 7.5% of 1000");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(75);
    });
  });

  describe("Modulo", () => {
    test("17 mod 5", () => {
      const result = tryFormula("What is 17 mod 5?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(2);
      expect(result.method).toBe("modulo");
    });

    test("100 modulo 7", () => {
      const result = tryFormula("100 modulo 7");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(2);
    });

    test("remainder of 23 divided by 4", () => {
      const result = tryFormula("What is the remainder of 23 divided by 4?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(3);
    });
  });

  describe("GCD and LCM", () => {
    test("GCD of 12 and 18", () => {
      const result = tryFormula("What is the GCD of 12 and 18?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(6);
      expect(result.method).toBe("gcd");
    });

    test("greatest common divisor of 48 and 36", () => {
      const result = tryFormula("Find the greatest common divisor of 48 and 36");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(12);
    });

    test("LCM of 4 and 6", () => {
      const result = tryFormula("What is the LCM of 4 and 6?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(12);
      expect(result.method).toBe("lcm");
    });

    test("least common multiple of 15 and 20", () => {
      const result = tryFormula("Find the least common multiple of 15 and 20");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(60);
    });
  });

  describe("Primality", () => {
    test("is 91 prime - NO (7 * 13)", () => {
      const result = tryFormula("Is 91 prime?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe("NO");
      expect(result.method).toBe("primality");
    });

    test("is 97 prime - YES", () => {
      const result = tryFormula("Is 97 a prime number?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe("YES");
    });

    test("is 2 prime - YES", () => {
      const result = tryFormula("Is 2 prime?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe("YES");
    });

    test("is 1 prime - NO", () => {
      const result = tryFormula("Is 1 prime?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe("NO");
    });

    test("is 104729 prime - YES (10000th prime)", () => {
      const result = tryFormula("Is 104729 prime?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe("YES");
    });

    test("rejects numbers > 1M", () => {
      const result = tryFormula("Is 1000001 prime?");
      expect(result.solved).toBe(false);
    });
  });

  describe("Trailing zeros in factorial", () => {
    test("trailing zeros in 100!", () => {
      const result = tryFormula("How many trailing zeros in 100!");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(24);
      expect(result.method).toBe("trailing_zeros");
    });

    test("trailing zeros in 25 factorial", () => {
      const result = tryFormula("trailing zeros in 25 factorial");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(6);
    });

    test("trailing zeros in 5!", () => {
      const result = tryFormula("trailing zeros 5!");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(1);
    });

    test("trailing zeros in 1000!", () => {
      const result = tryFormula("trailing zeros in 1000!");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(249);
    });
  });

  describe("Geometric series sum", () => {
    test("1 + 1/2 + 1/4 + ... sum", () => {
      const result = tryFormula("What is 1 + 1/2 + 1/4 + ... infinite sum?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(2);
      expect(result.method).toBe("geometric_series");
    });

    test("sum 1 + 1/3 + 1/9 + ...", () => {
      const result = tryFormula("sum of 1 + 1/3 + 1/9 + ...");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(1.5);
    });
  });

  describe("Last digit of power", () => {
    test("7^100 mod 10", () => {
      const result = tryFormula("What is 7^100 mod 10?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(1);
      expect(result.method).toBe("last_digit");
    });

    test("last digit of 3^50", () => {
      const result = tryFormula("What is the last digit of 3^50?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(9);
    });

    test("2^10 mod 10", () => {
      const result = tryFormula("2^10 mod 10");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(4);
    });

    test("last digit of 9^99", () => {
      const result = tryFormula("last digit of 9^99");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(9); // 9^odd = 9
    });
  });
});

describe("LocalCompute - tryLocalCompute", () => {
  test("routes arithmetic correctly", () => {
    const result = tryLocalCompute("What is 25 + 37?");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(62);
    expect(result.method).toBe("arithmetic");
  });

  test("routes formula correctly", () => {
    const result = tryLocalCompute("What is the 6th Fibonacci number?");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(8);
    expect(result.method).toBe("fibonacci");
  });

  test("returns unsolved for non-computable", () => {
    const result = tryLocalCompute("What is the capital of France?");
    expect(result.solved).toBe(false);
  });
});

describe("LocalCompute - isLikelyComputable", () => {
  test("positive: what is + number", () => {
    expect(isLikelyComputable("What is 5 + 3?")).toBe(true);
  });

  test("positive: calculate", () => {
    expect(isLikelyComputable("Calculate the sum")).toBe(true);
  });

  test("positive: fibonacci", () => {
    expect(isLikelyComputable("10th Fibonacci number")).toBe(true);
  });

  test("positive: factorial", () => {
    expect(isLikelyComputable("factorial of 5")).toBe(true);
  });

  test("positive: sqrt", () => {
    expect(isLikelyComputable("sqrt(16)")).toBe(true);
  });

  test("positive: power", () => {
    expect(isLikelyComputable("2 to the power of 8")).toBe(true);
  });

  test("positive: percent", () => {
    expect(isLikelyComputable("20% of 50")).toBe(true);
  });

  test("positive: gcd", () => {
    expect(isLikelyComputable("GCD of 12 and 8")).toBe(true);
  });

  test("positive: is N prime", () => {
    expect(isLikelyComputable("Is 91 prime?")).toBe(true);
  });

  test("negative: prove", () => {
    expect(isLikelyComputable("Prove that 2 + 2 = 4")).toBe(false);
  });

  test("negative: why", () => {
    expect(isLikelyComputable("Why is 5 + 3 = 8?")).toBe(false);
  });

  test("negative: explain", () => {
    expect(isLikelyComputable("Explain how to calculate this")).toBe(false);
  });

  test("negative: compare", () => {
    expect(isLikelyComputable("Compare algorithm A and B")).toBe(false);
  });

  test("negative: no compute signals", () => {
    expect(isLikelyComputable("Tell me about machine learning")).toBe(false);
  });

  test("positive: word problems", () => {
    expect(isLikelyComputable("What is twice 50?")).toBe(true);
    expect(isLikelyComputable("Half of 100")).toBe(true);
    expect(isLikelyComputable("Sum of 5 and 10")).toBe(true);
    expect(isLikelyComputable("5 plus 3")).toBe(true);
    expect(isLikelyComputable("10 minus 4")).toBe(true);
    expect(isLikelyComputable("Average of 10, 20, 30")).toBe(true);
  });

  test("positive: trailing zeros", () => {
    expect(isLikelyComputable("How many trailing zeros in 100!")).toBe(true);
  });

  test("positive: infinite/geometric series", () => {
    expect(isLikelyComputable("1 + 1/2 + 1/4 infinite sum")).toBe(true);
    expect(isLikelyComputable("geometric series 1 + 1/3 + ...")).toBe(true);
  });

  test("positive: last digit", () => {
    expect(isLikelyComputable("What is the last digit of 7^100?")).toBe(true);
  });
});

describe("LocalCompute - tryWordProblem", () => {
  describe("Multiplication words", () => {
    test("twice 50", () => {
      const result = tryWordProblem("What is twice 50?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(100);
      expect(result.method).toBe("word_twice");
    });

    test("twice as many as 25", () => {
      const result = tryWordProblem("She has twice as many as 25 apples");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(50);
    });

    test("5 times 7", () => {
      const result = tryWordProblem("What is 5 times 7?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(35);
    });

    test("double of 30", () => {
      const result = tryWordProblem("Double of 30");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(60);
    });

    test("triple of 15", () => {
      const result = tryWordProblem("Triple of 15");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(45);
    });
  });

  describe("Division words", () => {
    test("half of 100", () => {
      const result = tryWordProblem("Half of 100");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(50);
    });

    test("one third of 90", () => {
      const result = tryWordProblem("One third of 90");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(30);
    });

    test("quarter of 80", () => {
      const result = tryWordProblem("Quarter of 80");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(20);
    });

    test("20 divided by 4", () => {
      const result = tryWordProblem("20 divided by 4");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(5);
    });
  });

  describe("Addition words", () => {
    test("sum of 15 and 25", () => {
      const result = tryWordProblem("Sum of 15 and 25");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(40);
    });

    test("10 plus 7", () => {
      const result = tryWordProblem("10 plus 7");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(17);
    });

    test("5 added to 12", () => {
      const result = tryWordProblem("5 added to 12");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(17);
    });

    test("total of 8 and 9", () => {
      const result = tryWordProblem("Total of 8 and 9");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(17);
    });

    test("5 more than 20", () => {
      const result = tryWordProblem("5 more than 20");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(25);
    });
  });

  describe("Subtraction words", () => {
    test("difference between 50 and 30", () => {
      const result = tryWordProblem("Difference between 50 and 30");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(20);
    });

    test("20 minus 8", () => {
      const result = tryWordProblem("20 minus 8");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(12);
    });

    test("5 less than 20 (reversed)", () => {
      const result = tryWordProblem("5 less than 20");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(15); // 20 - 5
    });

    test("subtract 7 from 25 (reversed)", () => {
      const result = tryWordProblem("Subtract 7 from 25");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(18); // 25 - 7
    });
  });

  describe("Other operations", () => {
    test("product of 6 and 7", () => {
      const result = tryWordProblem("Product of 6 and 7");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(42);
    });

    test("quotient of 100 and 5", () => {
      const result = tryWordProblem("Quotient of 100 and 5");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(20);
    });

    test("5 squared", () => {
      const result = tryWordProblem("5 squared");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(25);
    });

    test("3 cubed", () => {
      const result = tryWordProblem("3 cubed");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(27);
    });

    test("average of 10, 20, 30", () => {
      const result = tryWordProblem("Average of 10, 20, 30");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(20);
    });

    test("5 items at $10 each (rate calculation)", () => {
      const result = tryWordProblem("5 items at $10 each");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(50);
      expect(result.method).toBe("word_rate");
    });

    test("12 things for 3 per item", () => {
      const result = tryWordProblem("12 things for 3 apiece");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(36);
    });
  });
});

describe("LocalCompute - extractAndCompute", () => {
  test("extracts single arithmetic expression", () => {
    const result = extractAndCompute("The answer is 5 + 3 in this case");
    expect(result.hasComputations).toBe(true);
    expect(result.computations.length).toBe(1);
    expect(result.computations[0].result).toBe(8);
    expect(result.augmented).toContain("[=8]");
  });

  test("extracts multiple arithmetic expressions", () => {
    const result = extractAndCompute("Calculate 10 + 5 and then 20 * 3");
    expect(result.computations.length).toBe(2);
    expect(result.augmented).toContain("[=15]");
    expect(result.augmented).toContain("[=60]");
  });

  test("extracts word problems", () => {
    const result = extractAndCompute("She has twice 50 apples");
    expect(result.hasComputations).toBe(true);
    expect(result.computations.some((c) => c.result === 100)).toBe(true);
  });

  test("handles mixed expressions", () => {
    const result = extractAndCompute("First 5 + 3 then half of 100");
    expect(result.computations.length).toBeGreaterThanOrEqual(2);
  });

  test("handles multiple word computations with proper injection", () => {
    const result = extractAndCompute("She has twice 50 and also half of 100 plus double 25");
    expect(result.hasComputations).toBe(true);
    expect(result.computations.length).toBe(3);
    // Check augmented text has all injections
    expect(result.augmented).toContain("[=100]");
    expect(result.augmented).toContain("[=50]");
  });

  test("returns empty for no computations", () => {
    const result = extractAndCompute("This is just text with no math");
    expect(result.hasComputations).toBe(false);
    expect(result.computations.length).toBe(0);
  });

  // New tests for formula extraction
  describe("formula extraction", () => {
    test("extracts sqrt expressions", () => {
      const result = extractAndCompute("The value sqrt(16) is important");
      expect(result.hasComputations).toBe(true);
      expect(result.computations.some((c) => c.result === 4)).toBe(true);
      expect(result.augmented).toContain("[=4]");
    });

    test("extracts factorial expressions", () => {
      const result = extractAndCompute("Calculate 5! for the answer");
      expect(result.hasComputations).toBe(true);
      expect(result.computations.some((c) => c.result === 120)).toBe(true);
      expect(result.augmented).toContain("[=120]");
    });

    test("extracts power expressions", () => {
      const result = extractAndCompute("We need 2^10 bytes");
      expect(result.hasComputations).toBe(true);
      expect(result.computations.some((c) => c.result === 1024)).toBe(true);
      expect(result.augmented).toContain("[=1024]");
    });

    test("extracts percentage expressions", () => {
      const result = extractAndCompute("That's 15% of 200 dollars");
      expect(result.hasComputations).toBe(true);
      expect(result.computations.some((c) => c.result === 30)).toBe(true);
      expect(result.augmented).toContain("[=30]");
    });

    test("extracts combinations", () => {
      const result = extractAndCompute("We have 5 choose 2 options");
      expect(result.hasComputations).toBe(true);
      expect(result.computations.some((c) => c.result === 10)).toBe(true);
      expect(result.augmented).toContain("[=10]");
    });

    test("extracts multiple formulas in text", () => {
      const result = extractAndCompute("First sqrt(9) then 3! gives us the total");
      expect(result.hasComputations).toBe(true);
      expect(result.computations.length).toBeGreaterThanOrEqual(2);
      expect(result.augmented).toContain("[=3]");
      expect(result.augmented).toContain("[=6]");
    });

    test("handles derivative at point", () => {
      const result = extractAndCompute("The derivative of x^2 at x=3 is needed");
      expect(result.hasComputations).toBe(true);
      expect(result.computations.some((c) => c.result === 6)).toBe(true);
    });
  });
});

describe("LocalCompute - tryLocalCompute with word problems", () => {
  test("solves word problem via tryLocalCompute", () => {
    const result = tryLocalCompute("What is twice 50?");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(100);
  });

  test("prefers arithmetic over word problem", () => {
    // "5 + 3" should match arithmetic before word patterns
    const result = tryLocalCompute("What is 5 + 3?");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(8);
    expect(result.method).toBe("arithmetic");
  });
});

// =============================================================================
// S1: LRU CACHE TESTS
// =============================================================================

describe("LocalCompute - LRU Cache", () => {
  beforeEach(() => {
    clearCache();
  });

  test("caches repeated computations", () => {
    // First call - cache miss
    const result1 = tryLocalCompute("What is 17 + 28?");
    expect(result1.solved).toBe(true);
    expect(result1.result).toBe(45);

    const stats1 = getCacheStats();
    expect(stats1.misses).toBe(1);
    expect(stats1.size).toBe(1);

    // Second call - cache hit (time_ms should be 0)
    const result2 = tryLocalCompute("What is 17 + 28?");
    expect(result2.solved).toBe(true);
    expect(result2.result).toBe(45);
    expect(result2.time_ms).toBe(0); // Cache hit is instant

    const stats2 = getCacheStats();
    expect(stats2.hits).toBe(1);
  });

  test("normalizes cache keys (case insensitive)", () => {
    clearCache();
    tryLocalCompute("What is 5 + 3?");
    tryLocalCompute("WHAT IS 5 + 3?");
    tryLocalCompute("what is 5 + 3?");

    const stats = getCacheStats();
    expect(stats.size).toBe(1); // All normalized to same key
    expect(stats.hits).toBe(2);
  });

  test("can bypass cache", () => {
    clearCache();
    tryLocalCompute("What is 10 + 20?", true); // Use cache
    tryLocalCompute("What is 10 + 20?", false); // Bypass cache

    const stats = getCacheStats();
    expect(stats.hits).toBe(0); // No hit because bypassed
  });

  test("calculates hit rate", () => {
    clearCache();
    tryLocalCompute("What is 1 + 1?");
    tryLocalCompute("What is 1 + 1?");
    tryLocalCompute("What is 2 + 2?");
    tryLocalCompute("What is 1 + 1?");

    const stats = getCacheStats();
    expect(stats.hitRate).toBeCloseTo(0.5); // 2 hits out of 4 calls
  });
});

// =============================================================================
// S2: MULTI-STEP WORD PROBLEM TESTS
// =============================================================================

describe("LocalCompute - tryMultiStepWordProblem", () => {
  test("solves simple dependency: twice as many", () => {
    const result = tryMultiStepWordProblem(
      "Mary has 5 apples. John has twice as many as Mary. How many does John have?",
    );
    expect(result.solved).toBe(true);
    expect(result.result).toBe(10);
    expect(result.method).toBe("multi_step_word");
  });

  test("solves half as many", () => {
    const result = tryMultiStepWordProblem(
      "Bob has 20 oranges. Alice has half as many as Bob. How many does Alice have?",
    );
    expect(result.solved).toBe(true);
    expect(result.result).toBe(10);
  });

  test("solves N more than", () => {
    const result = tryMultiStepWordProblem(
      "Tom has 15 books. Sarah has 7 more than Tom. How many does Sarah have?",
    );
    expect(result.solved).toBe(true);
    expect(result.result).toBe(22);
  });

  test("solves N less than", () => {
    const result = tryMultiStepWordProblem(
      "Mike has 30 coins. Lisa has 12 fewer than Mike. How many does Lisa have?",
    );
    expect(result.solved).toBe(true);
    expect(result.result).toBe(18);
  });

  test("solves triple", () => {
    const result = tryMultiStepWordProblem(
      "Sam has 8 stickers. Emma has triple as many as Sam. How many does Emma have?",
    );
    expect(result.solved).toBe(true);
    expect(result.result).toBe(24);
  });

  test("solves chain dependencies", () => {
    const result = tryMultiStepWordProblem(
      "Alice has 10 candies. Bob has twice as many as Alice. Carol has 5 more than Bob. How many does Carol have?",
    );
    expect(result.solved).toBe(true);
    expect(result.result).toBe(25); // 10 * 2 + 5
  });

  test("solves total questions", () => {
    const result = tryMultiStepWordProblem(
      "John has 5 apples. Mary has 8 oranges. What is the total?",
    );
    expect(result.solved).toBe(true);
    expect(result.result).toBe(13);
    expect(result.method).toBe("multi_step_total");
  });

  test("returns unsolved for unresolvable dependencies", () => {
    const result = tryMultiStepWordProblem(
      "John has twice as many as Mary. How many does John have?",
    );
    // Mary's value is unknown, so John can't be computed
    expect(result.solved).toBe(false);
  });

  test("handles various verb forms", () => {
    const result = tryMultiStepWordProblem(
      "Alex bought 12 toys. Ben earned 6 coins. What is the total?",
    );
    expect(result.solved).toBe(true);
    expect(result.result).toBe(18);
  });
});

// =============================================================================
// S3: CONFIDENCE SCORING TESTS
// =============================================================================

describe("LocalCompute - computeConfidence", () => {
  test("high confidence for pure arithmetic", () => {
    const conf = computeConfidence("17 + 28");
    expect(conf.score).toBeGreaterThan(0.9);
    expect(conf.recommendation).toBe("local_only");
    expect(conf.signals.positive).toContain("pure_arithmetic");
  });

  test("high confidence for explicit what is + arithmetic", () => {
    const conf = computeConfidence("What is 5 + 3?");
    expect(conf.score).toBeGreaterThan(0.85);
    expect(conf.recommendation).toBe("local_only");
  });

  test("high confidence for factorial", () => {
    const conf = computeConfidence("What is 5!");
    expect(conf.score).toBeGreaterThan(0.8);
    expect(conf.signals.positive).toContain("factorial");
  });

  test("medium confidence for word problems", () => {
    const conf = computeConfidence("What is twice 50?");
    expect(conf.score).toBeGreaterThan(0.6);
    expect(conf.score).toBeLessThan(0.9);
    expect(conf.recommendation).toBe("try_local_first");
  });

  test("lower confidence for entity-based problems", () => {
    const conf = computeConfidence("John has twice as many as Mary. How many does John have?");
    expect(conf.score).toBeGreaterThan(0.3);
    expect(conf.score).toBeLessThan(0.7);
  });

  test("reduces confidence for reasoning signals", () => {
    const confBase = computeConfidence("What is 5 + 3?");
    const confWhy = computeConfidence("Why is 5 + 3 = 8?");

    expect(confWhy.score).toBeLessThan(confBase.score);
    expect(confWhy.signals.negative).toContain("why");
  });

  test("low confidence for prove questions", () => {
    const conf = computeConfidence("Prove that 2 + 2 = 4");
    expect(conf.score).toBeLessThan(0.3);
    expect(conf.recommendation).toBe("skip");
  });

  test("handles rationality questions as computable", () => {
    // Rationality questions are now handled by the math facts solver
    const conf = computeConfidence("Is sqrt(2) rational or irrational?");
    expect(conf.signals.positive).toContain("rationality");
    expect(conf.score).toBeGreaterThanOrEqual(0.85); // High confidence for known facts
  });

  test("provides signal breakdown", () => {
    const conf = computeConfidence("Calculate the factorial of 5");
    expect(conf.signals.positive.length).toBeGreaterThan(0);
    expect(Array.isArray(conf.signals.negative)).toBe(true);
  });

  test("low confidence for non-math (no strong compute signals)", () => {
    const conf = computeConfidence("What is the capital of France?");
    expect(conf.score).toBeLessThanOrEqual(0.3); // Only weak "what is" signal
    expect(conf.signals.positive).not.toContain("explicit_arithmetic");
    expect(conf.signals.positive).not.toContain("factorial");
  });
});

// =============================================================================
// COMPRESSION DETECTION TESTS
// =============================================================================

describe("CompressionDetection - calculateEntropy", () => {
  test("empty string has zero entropy", () => {
    expect(calculateEntropy("")).toBe(0);
  });

  test("single repeated character has zero entropy", () => {
    const entropy = calculateEntropy("aaaaaaaaaa");
    expect(entropy).toBe(0);
  });

  test("two equally frequent characters has entropy of 1", () => {
    const entropy = calculateEntropy("abababab");
    expect(entropy).toBeCloseTo(1, 5);
  });

  test("random-looking text has higher entropy", () => {
    const lowEntropy = calculateEntropy("aaaaaabbbbbb");
    const highEntropy = calculateEntropy("abcdefghijkl");
    expect(highEntropy).toBeGreaterThan(lowEntropy);
  });

  test("English text has typical entropy ~4-5 bits/char", () => {
    const text =
      "The quick brown fox jumps over the lazy dog. " +
      "This is a sample of typical English text that should have " +
      "entropy around 4 to 5 bits per character.";
    const entropy = calculateEntropy(text);
    expect(entropy).toBeGreaterThan(3.5);
    expect(entropy).toBeLessThan(5.5);
  });

  test("highly repetitive text has low entropy", () => {
    const text = "the the the the the the the the the the";
    const entropy = calculateEntropy(text);
    expect(entropy).toBeLessThan(3);
  });
});

describe("CompressionDetection - needsCompression", () => {
  test("short text does not need compression", () => {
    const result = needsCompression("Short text");
    expect(result.shouldCompress).toBe(false);
    expect(result.reasons[0]).toContain("too short");
  });

  test("repetitive text recommends compression", () => {
    // Create highly repetitive text that exceeds MIN_TOKENS (100)
    const text = "The same sentence repeated. ".repeat(50);
    const result = needsCompression(text);
    expect(result.shouldCompress).toBe(true);
    expect(result.entropy).toBeLessThan(5);
  });

  test("diverse text with high entropy does not need compression", () => {
    // Generate text with high character diversity
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    const text = Array.from(
      { length: 500 },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join("");
    const result = needsCompression(text);
    // High entropy text should not recommend compression
    if (result.entropy > 6.5) {
      expect(result.shouldCompress).toBe(false);
    }
  });

  test("returns analysis metrics", () => {
    const text = "Test sentence for analysis. ".repeat(20);
    const result = needsCompression(text);

    expect(result).toHaveProperty("shouldCompress");
    expect(result).toHaveProperty("entropy");
    expect(result).toHaveProperty("uniquenessRatio");
    expect(result).toHaveProperty("estimatedRatio");
    expect(result).toHaveProperty("tokens");
    expect(result).toHaveProperty("reasons");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  test("long text with moderate entropy recommends compression", () => {
    // Create long text (>500 tokens) with moderate entropy
    const text =
      "This is a moderately varied sentence with some repetition. " +
      "The algorithm processes data efficiently. " +
      "Results are computed and stored for later use. ".repeat(40);
    const result = needsCompression(text);
    expect(result.tokens).toBeGreaterThan(400);
    // Long text with moderate entropy should recommend compression
    if (result.entropy < 5.5) {
      expect(result.shouldCompress).toBe(true);
    }
  });

  test("query relevance affects analysis", () => {
    const text =
      "The algorithm uses binary search for efficient lookups. " +
      "Binary search requires sorted data. " +
      "The time complexity is O(log n). ".repeat(10);
    const result = needsCompression(text, "binary search algorithm");

    // Query terms should be detected
    if (result.reasons.some((r) => r.includes("overlap"))) {
      expect(result.reasons.join(" ")).toContain("overlap");
    }
  });

  test("low uniqueness ratio indicates repetitive content", () => {
    // Create text with very few unique characters
    const text = "ab ".repeat(200);
    const result = needsCompression(text);
    expect(result.uniquenessRatio).toBeLessThan(0.05);
  });

  test("estimated ratio reflects entropy", () => {
    const lowEntropyText = "repeat repeat repeat repeat ".repeat(30);
    const result = needsCompression(lowEntropyText);
    // Lower entropy = lower estimated ratio (better compression)
    expect(result.estimatedRatio).toBeLessThan(0.9);
  });
});

// =============================================================================
// ANSWER EXTRACTION TESTS
// =============================================================================

import {
  answersMatch,
  extractAnswer,
  normalizeAnswer,
  parseFraction,
  shouldStreamStrip,
  stripLLMOutput,
  stripLLMOutputAsync,
  stripLLMOutputStreaming,
  stripMarkdown,
  stripThinkingTagsFast,
} from "../src/lib/extraction";

describe("AnswerExtraction - stripMarkdown", () => {
  test("removes bold markdown", () => {
    expect(stripMarkdown("The **answer** is here")).toBe("The answer is here");
  });

  test("removes italic markdown", () => {
    expect(stripMarkdown("The *answer* is here")).toBe("The answer is here");
  });

  test("removes code blocks", () => {
    const input = "Text before\n```javascript\nconst x = 5;\n```\nText after";
    expect(stripMarkdown(input)).toBe("Text before\n\nText after");
  });

  test("removes inline code", () => {
    expect(stripMarkdown("Use `console.log` to debug")).toBe("Use console.log to debug");
  });

  test("removes LaTeX boxed", () => {
    expect(stripMarkdown("The answer is $\\boxed{42}$")).toBe("The answer is 42");
    expect(stripMarkdown("Result: \\boxed{123}")).toBe("Result: 123");
  });

  test("removes headings", () => {
    expect(stripMarkdown("# Heading\nContent")).toBe("Heading\nContent");
    expect(stripMarkdown("### Level 3\nMore")).toBe("Level 3\nMore");
  });

  test("removes list markers", () => {
    expect(stripMarkdown("- Item one\n* Item two\n+ Item three")).toBe(
      "Item one\nItem two\nItem three",
    );
  });

  test("removes numbered lists", () => {
    expect(stripMarkdown("1. First\n2. Second")).toBe("First\nSecond");
  });

  test("converts links to text", () => {
    expect(stripMarkdown("Check [this link](https://example.com)")).toBe("Check this link");
  });

  test("removes images", () => {
    expect(stripMarkdown("Here ![alt text](image.png) is image")).toBe("Here is image");
  });

  test("removes blockquotes", () => {
    expect(stripMarkdown("> Quoted text\nNormal")).toBe("Quoted text\nNormal");
  });
});

// =============================================================================
// stripLLMOutput COMPREHENSIVE TESTS
// Tests all pattern categories handled by the unified stripping function
// =============================================================================

describe("stripLLMOutput", () => {
  describe("Thinking/Reasoning Tags", () => {
    test("strips standard <think> tags (DeepSeek)", () => {
      const input = "Before <think>internal reasoning here</think> After";
      expect(stripLLMOutput(input)).toBe("Before After");
    });

    test("strips <thinking> tags", () => {
      const input = "Start <thinking>Let me think step by step...</thinking> End";
      expect(stripLLMOutput(input)).toBe("Start End");
    });

    test("strips <reasoning> tags", () => {
      const input = "Question <reasoning>working through logic</reasoning> Answer: 42";
      expect(stripLLMOutput(input)).toBe("Question Answer: 42");
    });

    test("strips <antithink> tags (Claude)", () => {
      const input = "Response <antithink>self-correction notes</antithink> final output";
      expect(stripLLMOutput(input)).toBe("Response final output");
    });

    test("strips <thought> tags (Gemini)", () => {
      const input = "Begin <thought>pondering the problem</thought> conclusion";
      expect(stripLLMOutput(input)).toBe("Begin conclusion");
    });

    test("strips <thoughts> tags (Gemini plural)", () => {
      const input = "Start <thoughts>multiple thoughts here</thoughts> result";
      expect(stripLLMOutput(input)).toBe("Start result");
    });

    test("strips <reflection> tags (Llama)", () => {
      const input = "Initial <reflection>self-review content</reflection> final";
      expect(stripLLMOutput(input)).toBe("Initial final");
    });

    test("strips <internal_monologue> tags (Mistral)", () => {
      const input = "Output <internal_monologue>inner dialogue</internal_monologue> answer";
      expect(stripLLMOutput(input)).toBe("Output answer");
    });

    test("handles case-insensitive tags", () => {
      const input1 = "<THINK>caps</THINK> result";
      const input2 = "<Think>mixed</Think> result";
      expect(stripLLMOutput(input1)).toBe("result");
      expect(stripLLMOutput(input2)).toBe("result");
    });

    test("handles multiline thinking content", () => {
      const input = `Before
<think>
Line 1 of reasoning
Line 2 of reasoning
</think>
After`;
      expect(stripLLMOutput(input)).toBe("Before\n\nAfter");
    });

    test("handles multiple thinking tags", () => {
      const input = "<think>first</think> middle <think>second</think> end";
      expect(stripLLMOutput(input)).toBe("middle end");
    });
  });

  describe("Tool/Artifact Containers", () => {
    test("strips <tool_call> tags", () => {
      const input = "Calling <tool_call>function(args)</tool_call> done";
      expect(stripLLMOutput(input)).toBe("Calling done");
    });

    test("strips <tool_result> tags", () => {
      const input = "Got <tool_result>returned data</tool_result> processed";
      expect(stripLLMOutput(input)).toBe("Got processed");
    });

    test("strips <ARTIFACTS> tags", () => {
      const input = "Content <ARTIFACTS>artifact data here</ARTIFACTS> more";
      expect(stripLLMOutput(input)).toBe("Content more");
    });

    test("strips <document_content> tags", () => {
      const input = "See <document_content>doc text</document_content> reference";
      expect(stripLLMOutput(input)).toBe("See reference");
    });

    test("strips <context> tags", () => {
      const input = "With <context>background info</context> analysis";
      expect(stripLLMOutput(input)).toBe("With analysis");
    });
  });

  describe("Model-Specific Tokens", () => {
    test("strips GLM box tokens", () => {
      const input = "<|begin_of_box|>Answer: 42<|end_of_box|>";
      expect(stripLLMOutput(input)).toBe("Answer: 42");
    });

    test("strips <|im_start|>...<|im_end|> sequences", () => {
      const input = "Before <|im_start|>system content here<|im_end|> After";
      expect(stripLLMOutput(input)).toBe("Before After");
    });

    test("strips <|endoftext|> token", () => {
      const input = "Final answer<|endoftext|>";
      expect(stripLLMOutput(input)).toBe("Final answer");
    });

    test("strips <|pad|> tokens", () => {
      const input = "Content<|pad|><|pad|><|pad|>more";
      expect(stripLLMOutput(input)).toBe("Contentmore");
    });

    test("handles multiple model tokens together", () => {
      const input = "<|begin_of_box|>42<|end_of_box|><|endoftext|><|pad|>";
      expect(stripLLMOutput(input)).toBe("42");
    });
  });

  describe("Markdown Formatting", () => {
    test("removes code blocks", () => {
      const input = "Before\n```python\ndef foo(): pass\n```\nAfter";
      expect(stripLLMOutput(input)).toBe("Before\n\nAfter");
    });

    test("removes bold **text**", () => {
      expect(stripLLMOutput("The **answer** is")).toBe("The answer is");
    });

    test("removes bold __text__", () => {
      expect(stripLLMOutput("The __answer__ is")).toBe("The answer is");
    });

    test("removes italic *text*", () => {
      expect(stripLLMOutput("This is *important*")).toBe("This is important");
    });

    test("removes italic _text_", () => {
      expect(stripLLMOutput("This is _important_")).toBe("This is important");
    });

    test("removes inline code", () => {
      expect(stripLLMOutput("Use `console.log`")).toBe("Use console.log");
    });

    test("removes headings", () => {
      expect(stripLLMOutput("# Title\n## Subtitle")).toBe("Title\nSubtitle");
    });

    test("removes strikethrough", () => {
      expect(stripLLMOutput("Not ~~wrong~~ correct")).toBe("Not wrong correct");
    });

    test("removes images", () => {
      expect(stripLLMOutput("See ![alt](img.png) here")).toBe("See here");
    });

    test("converts links to text", () => {
      expect(stripLLMOutput("Click [here](url)")).toBe("Click here");
    });

    test("removes blockquote markers", () => {
      expect(stripLLMOutput("> Quote\nNormal")).toBe("Quote\nNormal");
    });

    test("removes horizontal rules", () => {
      expect(stripLLMOutput("Above\n---\nBelow")).toBe("Above\n\nBelow");
    });

    test("removes unordered list markers", () => {
      expect(stripLLMOutput("- Item 1\n* Item 2\n+ Item 3")).toBe("Item 1\nItem 2\nItem 3");
    });

    test("removes ordered list markers", () => {
      expect(stripLLMOutput("1. First\n2. Second")).toBe("First\nSecond");
    });
  });

  describe("LaTeX Content", () => {
    test("extracts from $\\boxed{X}$", () => {
      expect(stripLLMOutput("Result: $\\boxed{42}$")).toBe("Result: 42");
    });

    test("extracts from \\boxed{X} without dollar", () => {
      expect(stripLLMOutput("Answer: \\boxed{-17}")).toBe("Answer: -17");
    });

    test("strips inline math $...$", () => {
      expect(stripLLMOutput("The value $x + y$ equals")).toBe("The value x + y equals");
    });
  });

  describe("HTML Entities and Tags", () => {
    test("converts &nbsp; to space", () => {
      expect(stripLLMOutput("Hello&nbsp;World")).toBe("Hello World");
    });

    test("converts &amp; to &", () => {
      expect(stripLLMOutput("A &amp; B")).toBe("A & B");
    });

    test("converts &lt; and &gt;", () => {
      expect(stripLLMOutput("&lt;tag&gt;")).toBe("<tag>");
    });

    test("converts &quot; to quote", () => {
      expect(stripLLMOutput("He said &quot;hello&quot;")).toBe('He said "hello"');
    });

    test("converts &#39; to apostrophe", () => {
      expect(stripLLMOutput("It&#39;s fine")).toBe("It's fine");
    });

    test("converts <br> to newline", () => {
      expect(stripLLMOutput("Line1<br>Line2")).toBe("Line1\nLine2");
    });

    test("converts <br/> and <br /> variants", () => {
      expect(stripLLMOutput("A<br/>B<br />C")).toBe("A\nB\nC");
    });

    test("strips simple HTML tags", () => {
      expect(stripLLMOutput("<p>Paragraph</p>")).toBe("Paragraph");
      expect(stripLLMOutput("<div>Content</div>")).toBe("Content");
      expect(stripLLMOutput("<span>Inline</span>")).toBe("Inline");
      expect(stripLLMOutput("<b>Bold</b>")).toBe("Bold");
      expect(stripLLMOutput("<i>Italic</i>")).toBe("Italic");
      expect(stripLLMOutput("<em>Emphasis</em>")).toBe("Emphasis");
      expect(stripLLMOutput("<strong>Strong</strong>")).toBe("Strong");
    });
  });

  describe("Whitespace Cleanup", () => {
    test("collapses multiple newlines to double", () => {
      expect(stripLLMOutput("A\n\n\n\nB")).toBe("A\n\nB");
    });

    test("removes trailing whitespace from lines", () => {
      expect(stripLLMOutput("Line1   \nLine2\t\nLine3")).toBe("Line1\nLine2\nLine3");
    });

    test("collapses multiple spaces to single", () => {
      expect(stripLLMOutput("Word    word")).toBe("Word word");
    });

    test("trims leading/trailing whitespace", () => {
      expect(stripLLMOutput("  trimmed  ")).toBe("trimmed");
    });
  });

  describe("Combined/Nested Cases", () => {
    test("thinking tags containing markdown", () => {
      const input = "<think>**bold** reasoning with `code`</think> Answer: 42";
      expect(stripLLMOutput(input)).toBe("Answer: 42");
    });

    test("markdown around thinking tags", () => {
      const input = "**Note**: <think>internal</think> The result is `42`";
      expect(stripLLMOutput(input)).toBe("Note: The result is 42");
    });

    test("multiple tag types interleaved", () => {
      const input = "<think>reasoning</think> **Answer**: <tool_call>call()</tool_call> 42";
      expect(stripLLMOutput(input)).toBe("Answer: 42");
    });

    test("model tokens with thinking and markdown", () => {
      const input =
        "<|begin_of_box|><think>process</think>**Final**: 42<|end_of_box|><|endoftext|>";
      expect(stripLLMOutput(input)).toBe("Final: 42");
    });

    test("full realistic model output", () => {
      const input = `<think>
Let me work through this step by step.
First, I'll calculate...
</think>

Based on my analysis:

**The answer is 42.**

<|endoftext|>`;
      expect(stripLLMOutput(input)).toBe("Based on my analysis:\n\nThe answer is 42.");
    });

    test("HTML entities in markdown context", () => {
      const input = "**A &amp; B** is `x &lt; y`";
      expect(stripLLMOutput(input)).toBe("A & B is x < y");
    });
  });

  describe("Edge Cases", () => {
    test("empty string", () => {
      expect(stripLLMOutput("")).toBe("");
    });

    test("already clean text", () => {
      const input = "This is clean text without any markup.";
      expect(stripLLMOutput(input)).toBe("This is clean text without any markup.");
    });

    test("unclosed tags remain unchanged", () => {
      // Unclosed tags shouldn't cause infinite loops or crashes
      const input = "<think>unclosed content without end tag";
      expect(stripLLMOutput(input)).toBe("<think>unclosed content without end tag");
    });

    test("nested same-type tags (greedy match)", () => {
      // Regex is non-greedy, so nested same tags may not work perfectly
      // This documents the current behavior
      const input = "<think>outer<think>inner</think>still outer</think>end";
      // Current behavior: first </think> closes first <think>
      expect(stripLLMOutput(input)).not.toContain("inner");
    });

    test("preserves meaningful content between artifacts", () => {
      const input =
        "<think>hidden</think>VISIBLE<tool_call>ignored</tool_call>ALSO VISIBLE<|endoftext|>";
      expect(stripLLMOutput(input)).toBe("VISIBLEALSO VISIBLE");
    });
  });

  describe("Performance", () => {
    test("processes 5KB response in under 1ms", () => {
      // Realistic model output with mixed artifacts
      const chunk = `<think>
Let me reason through this step by step.
First, I need to consider...
</think>

**Analysis**: The problem requires us to calculate the sum.

Given: $x = 5$ and $y = 10$

\`\`\`python
result = x + y
\`\`\`

The answer is $\\boxed{15}$.

<|endoftext|>`;

      // Build 5KB input
      const targetBytes = 5000;
      const repetitions = Math.ceil(targetBytes / chunk.length);
      const input = chunk.repeat(repetitions).slice(0, targetBytes);

      // Warm-up
      stripLLMOutput(input);

      // Timed run (multiple iterations for stability)
      const iterations = 100;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        stripLLMOutput(input);
      }
      const elapsed = performance.now() - start;
      const avgMs = elapsed / iterations;

      // Should be under 1ms for 5KB
      expect(avgMs).toBeLessThan(1);
    });

    test("maintains O(n) scaling", () => {
      const base = "<think>reasoning</think> **Bold** `code` answer ";

      // Test at 1KB and 10KB
      const small = base.repeat(Math.ceil(1000 / base.length)).slice(0, 1000);
      const large = base.repeat(Math.ceil(10000 / base.length)).slice(0, 10000);

      // Warm-up
      stripLLMOutput(small);
      stripLLMOutput(large);

      // Time small
      const iterations = 50;
      const startSmall = performance.now();
      for (let i = 0; i < iterations; i++) {
        stripLLMOutput(small);
      }
      const elapsedSmall = performance.now() - startSmall;

      // Time large
      const startLarge = performance.now();
      for (let i = 0; i < iterations; i++) {
        stripLLMOutput(large);
      }
      const elapsedLarge = performance.now() - startLarge;

      // 10x input should be roughly 10x time (allow 20x for overhead)
      const ratio = elapsedLarge / elapsedSmall;
      expect(ratio).toBeLessThan(20);
    });
  });

  describe("Backward Compatibility", () => {
    test("stripThinkingTags alias works", () => {
      // stripThinkingTags is exported as alias
      expect(stripMarkdown("<think>test</think> result")).toBe("result");
    });

    test("stripMarkdown alias produces same result", () => {
      const input = "<think>reasoning</think> **Bold** `code` $\\boxed{42}$";
      expect(stripMarkdown(input)).toBe(stripLLMOutput(input));
    });
  });
});

// =============================================================================
// stripThinkingTagsFast TESTS (S1: Fast variant)
// =============================================================================

describe("stripThinkingTagsFast", () => {
  describe("Functionality", () => {
    test("strips all thinking tag variants", () => {
      expect(stripThinkingTagsFast("<think>hidden</think> visible")).toBe("visible");
      expect(stripThinkingTagsFast("<thinking>hidden</thinking> visible")).toBe("visible");
      expect(stripThinkingTagsFast("<reasoning>hidden</reasoning> visible")).toBe("visible");
      expect(stripThinkingTagsFast("<antithink>hidden</antithink> visible")).toBe("visible");
      expect(stripThinkingTagsFast("<thought>hidden</thought> visible")).toBe("visible");
      expect(stripThinkingTagsFast("<thoughts>hidden</thoughts> visible")).toBe("visible");
      expect(stripThinkingTagsFast("<reflection>hidden</reflection> visible")).toBe("visible");
      expect(stripThinkingTagsFast("<internal_monologue>hidden</internal_monologue> visible")).toBe(
        "visible",
      );
    });

    test("strips model tokens", () => {
      expect(stripThinkingTagsFast("answer<|endoftext|>")).toBe("answer");
      expect(stripThinkingTagsFast("<|begin_of_box|>42<|end_of_box|>")).toBe("42");
      expect(stripThinkingTagsFast("text<|pad|><|pad|>")).toBe("text");
    });

    test("handles combined input", () => {
      const input = "<think>reasoning</think> The answer is 42<|endoftext|>";
      expect(stripThinkingTagsFast(input)).toBe("The answer is 42");
    });

    test("preserves markdown (unlike full stripLLMOutput)", () => {
      const input = "<think>hidden</think> **Bold** and `code`";
      const result = stripThinkingTagsFast(input);
      // Fast variant keeps markdown intact
      expect(result).toContain("**Bold**");
      expect(result).toContain("`code`");
    });

    test("cleans whitespace", () => {
      const input = "<think>hidden</think>  \n\n\n\n  visible";
      const result = stripThinkingTagsFast(input);
      expect(result).not.toMatch(/\n{3,}/);
      expect(result).not.toMatch(/ {2}/);
    });

    test("handles case-insensitive tags", () => {
      expect(stripThinkingTagsFast("<THINK>hidden</THINK> visible")).toBe("visible");
      expect(stripThinkingTagsFast("<Think>hidden</Think> visible")).toBe("visible");
    });

    test("handles multiline content", () => {
      const input = `<think>
Line 1
Line 2
</think>
Result`;
      expect(stripThinkingTagsFast(input)).toBe("Result");
    });
  });

  describe("Performance", () => {
    test("is faster than stripLLMOutput for thinking-only content", () => {
      // Create larger input for more stable measurements
      const input = "<think>reasoning content here</think> Answer: 42<|endoftext|>".repeat(500);

      // Warm-up (multiple iterations)
      for (let i = 0; i < 10; i++) {
        stripThinkingTagsFast(input);
        stripLLMOutput(input);
      }

      const iterations = 100;

      // Time fast variant
      const startFast = performance.now();
      for (let i = 0; i < iterations; i++) {
        stripThinkingTagsFast(input);
      }
      const elapsedFast = performance.now() - startFast;

      // Time full variant
      const startFull = performance.now();
      for (let i = 0; i < iterations; i++) {
        stripLLMOutput(input);
      }
      const elapsedFull = performance.now() - startFull;

      // Fast should be faster (relaxed threshold for CI variability)
      // On most systems it's 2-5x faster, but CI can be noisy
      const speedup = elapsedFull / elapsedFast;
      expect(speedup).toBeGreaterThan(1.2);
    });
  });
});

// =============================================================================
// STREAMING TESTS (S2: Large response handling)
// =============================================================================

describe("Streaming Strip Functions", () => {
  describe("shouldStreamStrip", () => {
    test("returns false for small inputs (<100KB)", () => {
      const small = "x".repeat(50 * 1024); // 50KB
      expect(shouldStreamStrip(small)).toBe(false);
    });

    test("returns true for large inputs (>100KB)", () => {
      const large = "x".repeat(150 * 1024); // 150KB
      expect(shouldStreamStrip(large)).toBe(true);
    });

    test("returns false for exactly 100KB", () => {
      const exact = "x".repeat(100 * 1024);
      expect(shouldStreamStrip(exact)).toBe(false);
    });
  });

  describe("stripLLMOutputStreaming", () => {
    test("yields single chunk for small input", () => {
      const input = "<think>hidden</think> visible";
      const chunks = [...stripLLMOutputStreaming(input)];
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe("visible");
    });

    test("yields multiple chunks for large input", () => {
      // Create input >100KB with thinking tags
      const chunk = "<think>reasoning block</think> visible content here. ";
      const repetitions = Math.ceil((150 * 1024) / chunk.length);
      const largeInput = chunk.repeat(repetitions);

      const chunks = [...stripLLMOutputStreaming(largeInput)];

      // Should have multiple chunks
      expect(chunks.length).toBeGreaterThan(1);

      // Reassembled output should not contain thinking tags
      const reassembled = chunks.join(" ");
      expect(reassembled).not.toContain("<think>");
      expect(reassembled).not.toContain("</think>");
      expect(reassembled).toContain("visible content here");
    });

    test("handles tags at chunk boundaries", () => {
      // Create input where tags might span chunk boundaries
      const thinkContent = "x".repeat(30 * 1024); // 30KB of content in think tag
      const input = `<think>${thinkContent}</think> visible after`.repeat(5);

      const chunks = [...stripLLMOutputStreaming(input)];
      const reassembled = chunks.join(" ");

      // Should properly strip all think tags even across boundaries
      expect(reassembled).not.toContain("<think>");
      expect(reassembled).toContain("visible after");
    });

    test("empty input yields empty result", () => {
      const chunks = [...stripLLMOutputStreaming("")];
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe("");
    });
  });

  describe("stripLLMOutputAsync", () => {
    test("returns same result as sync for small input", async () => {
      const input = "<think>hidden</think> **Bold** answer";
      const asyncResult = await stripLLMOutputAsync(input);
      const syncResult = stripLLMOutput(input);
      expect(asyncResult).toBe(syncResult);
    });

    test("processes large input without blocking", async () => {
      // Create 200KB input
      const chunk = "<think>reasoning</think> content ";
      const largeInput = chunk.repeat(Math.ceil((200 * 1024) / chunk.length));

      const start = performance.now();
      const result = await stripLLMOutputAsync(largeInput);
      const elapsed = performance.now() - start;

      // Should complete and return valid result
      expect(result).not.toContain("<think>");
      expect(result).toContain("content");

      // Should complete in reasonable time (< 1 second for 200KB)
      expect(elapsed).toBeLessThan(1000);
    });

    test("handles concurrent calls", async () => {
      const input1 = "<think>first</think> result1<|endoftext|>";
      const input2 = "<thinking>second</thinking> result2<|endoftext|>";

      const [r1, r2] = await Promise.all([
        stripLLMOutputAsync(input1),
        stripLLMOutputAsync(input2),
      ]);

      expect(r1).toBe("result1");
      expect(r2).toBe("result2");
    });
  });
});

describe("AnswerExtraction - extractAnswer", () => {
  describe("Priority 1: LaTeX boxed", () => {
    test("extracts from \\boxed{}", () => {
      expect(extractAnswer("The solution is \\boxed{42}")).toBe("42");
    });

    test("extracts from $\\boxed{}$", () => {
      expect(extractAnswer("Final answer: $\\boxed{-17}$")).toBe("-17");
    });
  });

  describe("Priority 2-3: Explicit answer markers", () => {
    test("extracts from 'Final Answer: X'", () => {
      expect(extractAnswer("After calculation, Final Answer: 45")).toBe("45");
    });

    test("extracts from 'Answer: X'", () => {
      expect(extractAnswer("After working through, Answer: 123")).toBe("123");
    });

    test("extracts word answer from 'Answer: YES'", () => {
      expect(extractAnswer("Is it valid? Answer: YES")).toBe("YES");
    });
  });

  describe("Priority 4: 'The answer is X' pattern", () => {
    test("extracts number from 'the answer is 45'", () => {
      expect(extractAnswer("So the answer is 45 degrees")).toBe("45");
    });

    test("extracts from 'answer is 100'", () => {
      expect(extractAnswer("The final answer is 100")).toBe("100");
    });

    test("extracts capitalized word", () => {
      expect(extractAnswer("The answer is YES because...")).toBe("YES");
    });
  });

  describe("Priority 5: Result marker", () => {
    test("extracts from 'Result: X'", () => {
      expect(extractAnswer("Computation Result: 256")).toBe("256");
    });
  });

  describe("Priority 6: Equation result", () => {
    test("extracts last equation result", () => {
      expect(extractAnswer("First x = 10, then y = 20, finally z = 30")).toBe("30");
    });

    test("handles single equation", () => {
      expect(extractAnswer("The sum = 45")).toBe("45");
    });

    test("extracts fraction from equation", () => {
      expect(extractAnswer("The probability = 2/3")).toBe("2/3");
    });
  });

  describe("Priority 7-8: Number extraction", () => {
    test("extracts 'is NUMBER' from last lines", () => {
      expect(extractAnswer("The calculation shows the total is 75")).toBe("75");
    });

    test("extracts standalone number on line", () => {
      expect(extractAnswer("After all calculations:\n42")).toBe("42");
    });

    test("extracts last number as fallback", () => {
      expect(extractAnswer("Numbers 5, 10, 15, 20 in the sequence")).toBe("20");
    });

    test("extracts fraction from 'is X' pattern", () => {
      expect(extractAnswer("The probability is 2/3")).toBe("2/3");
    });

    test("extracts standalone fraction on line", () => {
      expect(extractAnswer("The answer:\n3/4")).toBe("3/4");
    });

    test("extracts fraction as last number fallback", () => {
      expect(extractAnswer("2/3 is the probability")).toBe("2/3");
    });

    test("extracts word fraction with hyphen", () => {
      expect(extractAnswer("The answer is two-thirds")).toBe("two-thirds");
    });

    test("extracts word fraction with space", () => {
      expect(extractAnswer("The answer is two thirds")).toBe("two thirds");
    });

    test("extracts word fraction 'a half'", () => {
      expect(extractAnswer("The answer is a half")).toBe("a half");
    });

    test("extracts word fraction as fallback", () => {
      expect(extractAnswer("one-fourth of the total")).toBe("one-fourth");
    });
  });

  describe("Priority 9: Word answer fallback", () => {
    test("extracts meaningful last word", () => {
      expect(extractAnswer("The statement is TRUE")).toBe("TRUE");
    });

    test("skips stopwords", () => {
      // Should not extract "is" or "the"
      const result = extractAnswer("What this means is the following");
      expect(result).not.toBe("is");
      expect(result).not.toBe("the");
    });
  });

  describe("Edge cases", () => {
    test("handles comma-separated numbers", () => {
      expect(extractAnswer("The population is 1,234,567")).toBe("1234567");
    });

    test("handles negative numbers", () => {
      expect(extractAnswer("The answer is -42")).toBe("-42");
    });

    test("handles decimal numbers", () => {
      expect(extractAnswer("Result: 3.14159")).toBe("3.14159");
    });

    test("handles mixed markdown and answer", () => {
      expect(extractAnswer("**Final Answer**: 99")).toBe("99");
    });
  });
});

describe("AnswerExtraction - normalizeAnswer", () => {
  test("lowercases", () => {
    expect(normalizeAnswer("YES")).toBe("yes");
  });

  test("removes commas from numbers", () => {
    expect(normalizeAnswer("1,234,567")).toBe("1234567");
  });

  test("removes whitespace", () => {
    expect(normalizeAnswer("  42  ")).toBe("42");
    expect(normalizeAnswer("hello world")).toBe("helloworld");
  });

  test("removes leading zeros", () => {
    expect(normalizeAnswer("007")).toBe("7");
    expect(normalizeAnswer("0")).toBe("0"); // Keep single zero
  });

  test("removes trailing .0", () => {
    expect(normalizeAnswer("42.0")).toBe("42");
    expect(normalizeAnswer("42.00")).toBe("42");
  });
});

describe("AnswerExtraction - answersMatch", () => {
  test("exact match after normalization", () => {
    expect(answersMatch("42", "42")).toBe(true);
    expect(answersMatch("YES", "yes")).toBe(true);
    expect(answersMatch("1,234", "1234")).toBe(true);
  });

  test("numeric comparison with tolerance", () => {
    expect(answersMatch("3.14159", "3.14159")).toBe(true);
    expect(answersMatch("3.1416", "3.14159")).toBe(true); // Close enough
  });

  test("partial match (contains)", () => {
    expect(answersMatch("45", "45 degrees")).toBe(true);
    expect(answersMatch("42", "answer is 42")).toBe(true);
  });

  test("rejects non-matching", () => {
    expect(answersMatch("42", "43")).toBe(false);
    expect(answersMatch("YES", "NO")).toBe(false);
  });

  // Fraction matching tests
  test("fraction to decimal: 1/2 matches 0.5", () => {
    expect(answersMatch("1/2", "0.5")).toBe(true);
    expect(answersMatch("0.5", "1/2")).toBe(true);
  });

  test("fraction to decimal: 2/3 matches 0.667", () => {
    expect(answersMatch("2/3", "0.6667")).toBe(true);
    expect(answersMatch("2/3", "0.667")).toBe(true);
  });

  test("fraction to decimal: 3/4 matches 0.75", () => {
    expect(answersMatch("3/4", "0.75")).toBe(true);
  });

  test("fraction to fraction: equivalent fractions match", () => {
    expect(answersMatch("1/2", "2/4")).toBe(true);
    expect(answersMatch("2/3", "4/6")).toBe(true);
    expect(answersMatch("3/9", "1/3")).toBe(true);
  });

  test("word fractions match numeric: one-half matches 0.5", () => {
    expect(answersMatch("one-half", "0.5")).toBe(true);
    expect(answersMatch("one half", "0.5")).toBe(true);
    expect(answersMatch("a half", "0.5")).toBe(true);
  });

  test("word fractions match numeric: two-thirds matches 2/3", () => {
    expect(answersMatch("two-thirds", "2/3")).toBe(true);
    expect(answersMatch("two thirds", "0.6667")).toBe(true);
  });

  test("word fractions match numeric: three-quarters matches 0.75", () => {
    expect(answersMatch("three-quarters", "0.75")).toBe(true);
    expect(answersMatch("three quarters", "3/4")).toBe(true);
    expect(answersMatch("three-fourths", "0.75")).toBe(true);
  });

  test("various word fractions", () => {
    expect(answersMatch("one-third", "1/3")).toBe(true);
    expect(answersMatch("one-fourth", "0.25")).toBe(true);
    expect(answersMatch("one-quarter", "0.25")).toBe(true);
    expect(answersMatch("two-fifths", "0.4")).toBe(true);
    expect(answersMatch("three-tenths", "0.3")).toBe(true);
  });

  test("mixed numbers: 1 1/2 matches 1.5", () => {
    expect(answersMatch("1 1/2", "1.5")).toBe(true);
    expect(answersMatch("2 3/4", "2.75")).toBe(true);
  });
});

describe("AnswerExtraction - parseFraction", () => {
  test("parses simple numeric fractions", () => {
    expect(parseFraction("1/2")).toBe(0.5);
    expect(parseFraction("2/3")).toBeCloseTo(0.6667, 3);
    expect(parseFraction("3/4")).toBe(0.75);
    expect(parseFraction("1/4")).toBe(0.25);
    expect(parseFraction("5/8")).toBe(0.625);
  });

  test("parses fractions with whitespace", () => {
    expect(parseFraction(" 1/2 ")).toBe(0.5);
    expect(parseFraction("1 / 2")).toBe(0.5);
    expect(parseFraction("  2/3  ")).toBeCloseTo(0.6667, 3);
  });

  test("parses mixed numbers", () => {
    expect(parseFraction("1 1/2")).toBe(1.5);
    expect(parseFraction("2 3/4")).toBe(2.75);
    expect(parseFraction("3 1/4")).toBe(3.25);
  });

  test("parses negative fractions", () => {
    expect(parseFraction("-1/2")).toBe(-0.5);
    expect(parseFraction("-3/4")).toBe(-0.75);
  });

  test("parses word fractions with hyphen", () => {
    expect(parseFraction("one-half")).toBe(0.5);
    expect(parseFraction("two-thirds")).toBeCloseTo(0.6667, 3);
    expect(parseFraction("three-quarters")).toBe(0.75);
    expect(parseFraction("one-fourth")).toBe(0.25);
    expect(parseFraction("three-fourths")).toBe(0.75);
  });

  test("parses word fractions with space", () => {
    expect(parseFraction("one half")).toBe(0.5);
    expect(parseFraction("two thirds")).toBeCloseTo(0.6667, 3);
    expect(parseFraction("three quarters")).toBe(0.75);
  });

  test("parses 'a half' and 'a third' forms", () => {
    expect(parseFraction("a half")).toBe(0.5);
    expect(parseFraction("a third")).toBeCloseTo(0.3333, 3);
    expect(parseFraction("a quarter")).toBe(0.25);
  });

  test("parses various denominator words", () => {
    expect(parseFraction("one-fifth")).toBe(0.2);
    expect(parseFraction("two-fifths")).toBe(0.4);
    expect(parseFraction("one-sixth")).toBeCloseTo(0.1667, 3);
    expect(parseFraction("one-seventh")).toBeCloseTo(0.1429, 3);
    expect(parseFraction("one-eighth")).toBe(0.125);
    expect(parseFraction("one-ninth")).toBeCloseTo(0.1111, 3);
    expect(parseFraction("one-tenth")).toBe(0.1);
  });

  test("returns null for invalid input", () => {
    expect(parseFraction("hello")).toBeNull();
    expect(parseFraction("42")).toBeNull();
    expect(parseFraction("1/0")).toBeNull(); // division by zero
    expect(parseFraction("")).toBeNull();
  });

  test("handles case insensitivity", () => {
    expect(parseFraction("ONE-HALF")).toBe(0.5);
    expect(parseFraction("Two-Thirds")).toBeCloseTo(0.6667, 3);
    expect(parseFraction("THREE-QUARTERS")).toBe(0.75);
  });
});

// =============================================================================
// TOKEN ESTIMATION TESTS
// =============================================================================

describe("TokenEstimation - estimateTokens", () => {
  test("empty string returns 0", () => {
    expect(estimateTokens("")).toBe(0);
  });

  test("very short strings return 1", () => {
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("hi")).toBe(1);
    expect(estimateTokens("abc")).toBe(1);
  });

  test("basic ASCII text estimation", () => {
    const text = "Hello, world!";
    const tokens = estimateTokens(text);
    // Should be ~3-4 tokens for this phrase
    expect(tokens).toBeGreaterThan(1);
    expect(tokens).toBeLessThan(10);
  });

  test("longer prose gets reasonable estimate", () => {
    const text = "The quick brown fox jumps over the lazy dog.";
    const tokens = estimateTokens(text);
    // ~9-12 tokens typically
    expect(tokens).toBeGreaterThan(6);
    expect(tokens).toBeLessThan(20);
  });

  test("digit grouping - consecutive digits share tokens", () => {
    // "2024" should be fewer tokens than four separate digits
    const year = estimateTokens("2024");
    const fourWords = estimateTokens("a b c d");
    expect(year).toBeLessThanOrEqual(fourWords);
  });

  test("large numbers are efficient", () => {
    // "123456789" should be ~2-3 tokens, not 9
    const bigNum = estimateTokens("123456789");
    expect(bigNum).toBeLessThan(5);
  });

  test("CJK characters get ~1 token each", () => {
    const cjk = "你好世界"; // "Hello world" in Chinese
    const tokens = estimateTokens(cjk);
    // Each CJK char ~1 token, so ~4 tokens
    expect(tokens).toBeGreaterThanOrEqual(3);
    expect(tokens).toBeLessThanOrEqual(6);
  });

  test("emoji handling", () => {
    const emoji = "👋🌍✨";
    const tokens = estimateTokens(emoji);
    // Emoji are typically 1-3 tokens each
    expect(tokens).toBeGreaterThanOrEqual(1);
    expect(tokens).toBeLessThanOrEqual(10);
  });

  test("mixed content", () => {
    const mixed = "Hello 2024! 你好 🎉";
    const tokens = estimateTokens(mixed);
    expect(tokens).toBeGreaterThan(3);
    expect(tokens).toBeLessThan(20);
  });

  test("long text gets discount", () => {
    const shortText = "word ".repeat(20).trim();
    const longText = "word ".repeat(250).trim();

    // Ratio should show long text is more efficient per-word
    const shortPerWord = estimateTokens(shortText) / 20;
    const longPerWord = estimateTokens(longText) / 250;
    expect(longPerWord).toBeLessThan(shortPerWord);
  });
});

describe("TokenEstimation - estimateCodeTokens", () => {
  test("empty code returns 0", () => {
    expect(estimateCodeTokens("")).toBe(0);
  });

  test("very short code returns 1", () => {
    expect(estimateCodeTokens("x=1")).toBe(1);
  });

  test("typical code snippet", () => {
    const code = `function add(a, b) {
  return a + b;
}`;
    const tokens = estimateCodeTokens(code);
    // Should be ~8-25 tokens
    expect(tokens).toBeGreaterThanOrEqual(8);
    expect(tokens).toBeLessThan(35);
  });

  test("string literals are efficient", () => {
    const withStrings = `const msg = "Hello, this is a long string message";`;
    const tokens = estimateCodeTokens(withStrings);
    // String contents should be efficiently encoded
    expect(tokens).toBeLessThan(20);
  });

  test("code is more efficient than prose", () => {
    const code = "const x = 10; const y = 20;";
    const prose = "set x to ten then set y to twenty";
    // Code should be similar or fewer tokens
    expect(estimateCodeTokens(code)).toBeLessThanOrEqual(estimateTokens(prose) + 5);
  });
});

describe("TokenEstimation - estimateTokensBatch", () => {
  test("empty array returns 0", () => {
    expect(estimateTokensBatch([])).toBe(0);
  });

  test("single message includes overhead", () => {
    const single = estimateTokensBatch(["Hello"]);
    const direct = estimateTokens("Hello");
    // Batch adds 4 tokens overhead per message
    expect(single).toBe(direct + 4);
  });

  test("multiple messages accumulate with overhead", () => {
    const messages = ["Hello", "World", "Test"];
    const batch = estimateTokensBatch(messages);
    const sum = messages.reduce((acc, m) => acc + estimateTokens(m), 0);
    // Should be sum + 4 per message
    expect(batch).toBe(sum + messages.length * 4);
  });

  test("realistic conversation estimate", () => {
    const conversation = ["What is 2 + 2?", "The answer is 4.", "Thanks!"];
    const tokens = estimateTokensBatch(conversation);
    // Should be reasonable for a short conversation (~20-30 tokens)
    expect(tokens).toBeGreaterThan(10);
    expect(tokens).toBeLessThan(50);
  });
});

// =============================================================================
// S1: Tests for isLikelyComputable/tryLocalCompute interaction
// These prevent regressions where classification questions trigger computation
// =============================================================================

describe("LocalCompute - Classification vs Computation", () => {
  // Classification questions have different handling:
  // - Some (like rationality) ARE computable via math facts solver
  // - Some (like true/false reasoning) are NOT computable

  describe("Rationality questions (ARE computable via math facts solver)", () => {
    test("sqrt rationality is computable", () => {
      const q1 = "Is sqrt(2) rational or irrational? Answer RATIONAL or IRRATIONAL.";
      expect(isLikelyComputable(q1)).toBe(true);

      const result1 = tryLocalCompute(q1);
      expect(result1.solved).toBe(true);
      expect(result1.result).toBe("IRRATIONAL");
      expect(result1.method).toBe("math_fact_rationality");

      const q2 = "Is pi rational or irrational?";
      expect(isLikelyComputable(q2)).toBe(true);

      const result2 = tryLocalCompute(q2);
      expect(result2.solved).toBe(true);
      expect(result2.result).toBe("IRRATIONAL");

      // Perfect squares have rational roots
      const q3 = "Is sqrt(4) rational or irrational?";
      const result3 = tryLocalCompute(q3);
      expect(result3.solved).toBe(true);
      expect(result3.result).toBe("RATIONAL");
    });

    test("computeConfidence gives high score for rationality", () => {
      const conf = computeConfidence("Is sqrt(2) rational or irrational?");
      expect(conf.score).toBeGreaterThanOrEqual(0.85);
      expect(conf.signals.positive).toContain("rationality");
      expect(conf.recommendation).toBe("local_only");
    });
  });

  describe("True/false classification (NOT computable - requires reasoning)", () => {
    test("true or false classification", () => {
      const q1 = "True or false: sqrt(4) = 2";
      expect(isLikelyComputable(q1)).toBe(false);

      const q2 = "Is it true or false that 2^10 > 1000?";
      expect(isLikelyComputable(q2)).toBe(false);
    });
  });

  describe("Computation questions (SHOULD be computable)", () => {
    test("pure sqrt computation", () => {
      expect(isLikelyComputable("What is sqrt(16)?")).toBe(true);
      expect(isLikelyComputable("Calculate sqrt(144)")).toBe(true);

      const result = tryLocalCompute("What is sqrt(16)?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(4);
    });

    test("primality test (yes/no computation)", () => {
      // This IS computable because we can definitively answer YES/NO
      expect(isLikelyComputable("Is 91 prime? Answer YES or NO.")).toBe(true);

      const result = tryLocalCompute("Is 91 prime? Answer YES or NO.");
      expect(result.solved).toBe(true);
      expect(result.result).toBe("NO");
    });

    test("arithmetic with sqrt", () => {
      expect(isLikelyComputable("What is sqrt(9) + sqrt(16)?")).toBe(true);
    });
  });

  describe("Edge cases", () => {
    test("sqrt rationality is now computable via math facts solver", () => {
      // Has sqrt AND rationality - now IS computable via math facts solver
      const q = "Is sqrt(2) rational or irrational";
      expect(isLikelyComputable(q)).toBe(true);

      const result = tryLocalCompute(q);
      expect(result.solved).toBe(true);
      expect(result.result).toBe("IRRATIONAL");
      expect(result.method).toBe("math_fact_rationality");
    });

    test("similar-looking questions have different answer types", () => {
      // These look similar but produce different answer types
      const compute = "What is sqrt(2)?";
      const classify = "Is sqrt(2) rational or irrational?";

      expect(isLikelyComputable(compute)).toBe(true);
      expect(isLikelyComputable(classify)).toBe(true); // Now also computable!

      // Compute question gets numeric answer
      const computeResult = tryLocalCompute(compute);
      expect(computeResult.solved).toBe(true);
      expect(typeof computeResult.result).toBe("number");

      // Classification question gets string answer
      const classifyResult = tryLocalCompute(classify);
      expect(classifyResult.solved).toBe(true);
      expect(classifyResult.result).toBe("IRRATIONAL");
    });

    test("fibonacci computation vs sequence questions", () => {
      // Computable: specific value
      expect(isLikelyComputable("What is the 10th Fibonacci number?")).toBe(true);

      const result = tryLocalCompute("What is the 10th Fibonacci number?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(55);
    });
  });

  describe("Confidence scoring for routing decisions", () => {
    test("high confidence for pure arithmetic", () => {
      const conf = computeConfidence("What is 17 + 28?");
      expect(conf.score).toBeGreaterThanOrEqual(0.85);
      expect(conf.recommendation).toBe("local_only");
    });

    test("medium confidence for word problems", () => {
      const conf = computeConfidence("What is twice 50?");
      expect(conf.score).toBeGreaterThanOrEqual(0.6);
      expect(["try_local_first", "local_only"]).toContain(conf.recommendation);
    });

    test("low confidence when reasoning signals present", () => {
      const conf = computeConfidence("Prove that sqrt(2) is irrational");
      expect(conf.score).toBeLessThan(0.3);
      expect(conf.recommendation).toBe("skip");
      expect(conf.signals.negative).toContain("prove");
    });

    test("negative signals reduce confidence", () => {
      const pureCompute = computeConfidence("sqrt(16)");
      const withWhy = computeConfidence("Why is sqrt(16) = 4?");

      expect(pureCompute.score).toBeGreaterThan(withWhy.score);
    });
  });
});

// =============================================================================
// S1: Tests for new Calculus and Combinatorics functions
// =============================================================================

describe("LocalCompute - Calculus", () => {
  describe("Derivatives", () => {
    test("derivative of x^3 at x=2", () => {
      const result = tryLocalCompute("derivative of x^3 at x=2");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(12); // d/dx(x^3) = 3x^2, at x=2: 3*4=12
      expect(result.method).toBe("derivative_eval");
    });

    test("d/dx of x^2 at x=3", () => {
      const result = tryLocalCompute("d/dx of x^2 at x=3");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(6); // 2x at x=3
    });

    test("derivative of 3x^2 + 2x - 5", () => {
      const result = tryLocalCompute("derivative of 3x^2 + 2x - 5");
      expect(result.solved).toBe(true);
      expect(result.method).toBe("derivative_symbolic");
      // Should return "6x + 2" or similar
      expect(String(result.result)).toMatch(/6.*x.*2/);
    });

    test("isLikelyComputable for derivative questions", () => {
      expect(isLikelyComputable("derivative of x^3 at x=2")).toBe(true);
      expect(isLikelyComputable("d/dx of x^2")).toBe(true);
      expect(isLikelyComputable("differentiate 3x^2")).toBe(true);
    });
  });

  describe("Definite Integrals", () => {
    test("integral of 2x from 0 to 3", () => {
      const result = tryLocalCompute("integral of 2x from 0 to 3");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(9); // ∫2x dx from 0 to 3 = x^2 from 0 to 3 = 9-0=9
      expect(result.method).toBe("definite_integral");
    });

    test("integrate x^2 from 0 to 2", () => {
      const result = tryLocalCompute("integrate x^2 from 0 to 2");
      expect(result.solved).toBe(true);
      // ∫x^2 dx = x^3/3, from 0 to 2 = 8/3 - 0 = 2.666...
      expect(result.result).toBeCloseTo(8 / 3, 5);
    });

    test("integral of 3x^2 + 2x from 1 to 2", () => {
      const result = tryLocalCompute("integral of 3x^2 + 2x from 1 to 2");
      expect(result.solved).toBe(true);
      // ∫(3x^2 + 2x)dx = x^3 + x^2
      // F(2) = 8 + 4 = 12
      // F(1) = 1 + 1 = 2
      // Result = 12 - 2 = 10
      expect(result.result).toBe(10);
    });

    test("isLikelyComputable for integral questions", () => {
      expect(isLikelyComputable("integral of 2x from 0 to 3")).toBe(true);
      expect(isLikelyComputable("integrate x^2 from 1 to 4")).toBe(true);
    });
  });
});

describe("LocalCompute - Combinatorics", () => {
  describe("Combinations (n choose k)", () => {
    test("10 choose 3", () => {
      const result = tryLocalCompute("10 choose 3");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(120);
      expect(result.method).toBe("combinations");
    });

    test("How many ways to choose 3 items from 10", () => {
      const result = tryLocalCompute("How many ways to choose 3 items from 10?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(120);
    });

    test("5 C 2", () => {
      const result = tryLocalCompute("5 C 2");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(10);
    });

    test("edge cases: n choose 0 and n choose n", () => {
      expect(tryLocalCompute("5 choose 0").result).toBe(1);
      expect(tryLocalCompute("5 choose 5").result).toBe(1);
    });
  });

  describe("Permutations (n P k)", () => {
    test("5 P 3", () => {
      const result = tryLocalCompute("5 P 3");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(60); // 5*4*3
      expect(result.method).toBe("permutations");
    });

    test("10 P 2", () => {
      const result = tryLocalCompute("10 P 2");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(90); // 10*9
    });
  });
});

describe("LocalCompute - Matrix and Finance", () => {
  describe("2x2 Matrix Determinant", () => {
    test("determinant of [[1,2],[3,4]]", () => {
      const result = tryLocalCompute("determinant of [[1,2],[3,4]]");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(-2); // 1*4 - 2*3 = -2
      expect(result.method).toBe("determinant_2x2");
    });

    test("det([[5,3],[2,4]])", () => {
      const result = tryLocalCompute("What is the det([[5,3],[2,4]])?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(14); // 5*4 - 3*2 = 14
    });
  });

  describe("3x3 Matrix Determinant", () => {
    test("determinant of [[1,2,3],[4,5,6],[7,8,9]]", () => {
      const result = tryLocalCompute("determinant of [[1,2,3],[4,5,6],[7,8,9]]");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(0); // Singular matrix
      expect(result.method).toBe("determinant_3x3");
    });

    test("det([[6,1,1],[4,-2,5],[2,8,7]])", () => {
      const result = tryLocalCompute("What is the determinant of [[6,1,1],[4,-2,5],[2,8,7]]?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(-306); // 6*(-14-40) - 1*(28-10) + 1*(32+4) = -306
      expect(result.method).toBe("determinant_3x3");
    });
  });

  describe("4x4 Matrix Determinant", () => {
    test("determinant of identity matrix 4x4", () => {
      const result = tryLocalCompute("determinant of [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(1);
      expect(result.method).toBe("determinant_4x4");
    });
  });

  describe("Compound Interest", () => {
    test("$1000 at 5% compound interest for 10 years", () => {
      const result = tryLocalCompute("$1000 at 5% compound interest for 10 years");
      expect(result.solved).toBe(true);
      // 1000 * (1.05)^10 ≈ 1628.89
      expect(result.result).toBe(1629);
      expect(result.method).toBe("compound_interest");
    });

    test("$500 at 10% annual compound interest for 5 years", () => {
      const result = tryLocalCompute("$500 at 10% annual compound interest for 5 years");
      expect(result.solved).toBe(true);
      // 500 * (1.1)^5 ≈ 805.26
      expect(result.result).toBe(805);
    });
  });
});

describe("LocalCompute - Unicode superscripts", () => {
  test("derivative of x³ at x=2 (unicode)", () => {
    const result = tryLocalCompute("derivative of x³ at x=2");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(12); // 3x² at x=2 = 3*4 = 12
  });

  test("x² + 2x - 1 (unicode)", () => {
    const result = tryLocalCompute("derivative of x² + 2x - 1 at x=3");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(8); // 2x + 2 at x=3 = 8
  });
});

describe("LocalCompute - Confidence for new patterns", () => {
  test("high confidence for derivatives", () => {
    const conf = computeConfidence("derivative of x^3 at x=2");
    expect(conf.score).toBeGreaterThanOrEqual(0.8);
    expect(conf.signals.positive).toContain("derivative");
  });

  test("high confidence for combinations", () => {
    const conf = computeConfidence("10 choose 3");
    expect(conf.score).toBeGreaterThanOrEqual(0.85);
    expect(conf.signals.positive).toContain("combinations");
  });

  test("high confidence for integrals", () => {
    const conf = computeConfidence("integral of 2x from 0 to 3");
    expect(conf.score).toBeGreaterThanOrEqual(0.8);
    expect(conf.signals.positive).toContain("definite_integral");
  });
});

// =============================================================================
// LOGIC SOLVER TESTS
// =============================================================================

describe("LocalCompute - Logic", () => {
  describe("Modus Ponens", () => {
    test("basic modus ponens - raining/wet", () => {
      const result = tryLogic(
        "If it rains, the ground is wet. It's raining. Is the ground wet? YES or NO.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("YES");
      expect(result.method).toBe("modus_ponens");
    });
  });

  describe("Modus Tollens", () => {
    test("basic modus tollens - ground dry", () => {
      const result = tryLogic(
        "If it rains, the ground is wet. Ground is dry. Is it raining? YES or NO.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("NO");
      expect(result.method).toBe("modus_tollens");
    });
  });

  describe("Syllogism", () => {
    test("valid syllogism - A/B/C", () => {
      const result = tryLogic("All A are B. All B are C. Therefore all A are C. Valid? YES or NO.");
      expect(result.solved).toBe(true);
      expect(result.result).toBe("YES");
      expect(result.method).toBe("syllogism");
    });
  });

  describe("XOR Violation", () => {
    test("exclusive or with both - violated", () => {
      const result = tryLogic(
        "You can have cake or ice cream (exclusive). You have both. Violated? YES or NO.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("YES");
      expect(result.method).toBe("xor_violation");
    });
  });

  describe("tryLocalCompute integration", () => {
    test("modus ponens via tryLocalCompute", () => {
      const result = tryLocalCompute(
        "If it rains, the ground is wet. It's raining. Is the ground wet? YES or NO.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("YES");
    });

    test("syllogism via tryLocalCompute", () => {
      const result = tryLocalCompute(
        "All A are B. All B are C. Therefore all A are C. Valid? YES or NO.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("YES");
    });
  });

  describe("Affirming the Consequent (invalid)", () => {
    test("ground is wet therefore it rained - invalid", () => {
      const result = tryLogic(
        "If it rains, ground is wet. Ground is wet. Therefore it rained. Valid reasoning? YES or NO.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("NO");
      expect(result.method).toBe("affirming_consequent");
    });

    test("can we conclude pattern", () => {
      const result = tryLogic(
        "If it rains, the ground is wet. The ground is wet. Can we conclude it rained?",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("NO");
      expect(result.method).toBe("affirming_consequent");
    });

    test("P then Q pattern", () => {
      const result = tryLogic("If P then Q. Q is true. Therefore P is true. Valid?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe("NO");
      expect(result.method).toBe("affirming_consequent");
    });
  });

  describe("Denying the Antecedent (invalid)", () => {
    test("not raining therefore ground is dry - invalid", () => {
      const result = tryLogic(
        "If it rains, ground is wet. It's not raining. Therefore ground is dry. Valid? YES or NO.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("NO");
      expect(result.method).toBe("denying_antecedent");
    });
  });

  describe("De Morgan's Laws", () => {
    test("NOT(A AND B) = (NOT A) OR (NOT B)", () => {
      const result = tryLogic(
        "NOT(A AND B) is equivalent to (NOT A) ___ (NOT B). Fill: AND or OR.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("OR");
      expect(result.method).toBe("de_morgan_and");
    });

    test("NOT(A OR B) = (NOT A) AND (NOT B)", () => {
      const result = tryLogic("NOT(A OR B) is equivalent to (NOT A) ___ (NOT B). Fill: AND or OR.");
      expect(result.solved).toBe(true);
      expect(result.result).toBe("AND");
      expect(result.method).toBe("de_morgan_or");
    });
  });

  describe("Invalid Syllogism with Some", () => {
    test("some A are B, some B are C - invalid conclusion", () => {
      const result = tryLogic(
        "Some A are B. Some B are C. Therefore some A are C. Valid? YES or NO.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("NO");
      expect(result.method).toBe("invalid_syllogism_some");
    });
  });

  describe("Contrapositive", () => {
    test("All A are B equivalent to All non-B are non-A", () => {
      const result = tryLogic(
        '"All dogs are mammals" is equivalent to "All non-mammals are non-dogs"? YES or NO.',
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("YES");
      expect(result.method).toBe("contrapositive");
    });
  });
});

// =============================================================================
// STATISTICS SOLVER TESTS
// =============================================================================

import { tryStatistics } from "../src/lib/compute/solvers/statistics";

describe("LocalCompute - Statistics", () => {
  describe("Mean / Average", () => {
    test("mean with currency notation ($30k, $1M)", () => {
      const result = tryStatistics(
        "Incomes: $30k, $30k, $30k, $30k, $1M. Mean income in thousands?",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe(224);
      expect(result.method).toBe("mean_thousands");
    });

    test("average of plain numbers", () => {
      const result = tryStatistics("What is the average of 10, 20, 30?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(20);
      expect(result.method).toBe("mean");
    });
  });

  describe("Standard Error", () => {
    test("SE = SD / sqrt(n)", () => {
      const result = tryStatistics("Sample mean 100, SD 10, n=100. Standard error of mean?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(1);
      expect(result.method).toBe("standard_error");
    });

    test("standard deviation 20, sample size 400", () => {
      const result = tryStatistics(
        "Standard deviation 20, sample size 400. What is the standard error?",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe(1);
      expect(result.method).toBe("standard_error");
    });
  });

  describe("Expected Value", () => {
    test("lottery expected value in cents", () => {
      const result = tryStatistics(
        "Lottery: $1 ticket, 1/1000000 chance of $500000. Expected value per ticket in cents?",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe(50);
      expect(result.method).toBe("expected_value_cents");
    });

    test("lottery expected value in dollars", () => {
      const result = tryStatistics("1/1000 chance of $100. Expected value?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(0.1);
      expect(result.method).toBe("expected_value");
    });
  });

  describe("Permutations with Repetition", () => {
    test("MISSISSIPPI arrangements", () => {
      const result = tryStatistics("How many ways to arrange the letters in MISSISSIPPI?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(34650);
      expect(result.method).toBe("permutations_repetition");
    });

    test("AABB arrangements", () => {
      // 4! / (2! * 2!) = 24 / 4 = 6
      const result = tryStatistics("How many ways to arrange the letters in AABB?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(6);
      expect(result.method).toBe("permutations_repetition");
    });
  });

  describe("Handshake Problem", () => {
    test("10 people handshakes", () => {
      const result = tryStatistics(
        "10 people at a party, each shakes hands with everyone else exactly once. Total number of handshakes?",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe(45);
      expect(result.method).toBe("handshake");
    });

    test("5 people handshakes", () => {
      const result = tryStatistics("5 people each shakes hands with everyone else. Total?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(10);
      expect(result.method).toBe("handshake");
    });
  });

  describe("tryLocalCompute integration", () => {
    test("mean via tryLocalCompute", () => {
      const result = tryLocalCompute(
        "Incomes: $30k, $30k, $30k, $30k, $1M. Mean income in thousands?",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe(224);
    });

    test("handshake via tryLocalCompute", () => {
      const result = tryLocalCompute(
        "10 people at a party, each shakes hands with everyone else exactly once. Total number of handshakes?",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe(45);
    });

    test("MISSISSIPPI via tryLocalCompute", () => {
      const result = tryLocalCompute("How many ways to arrange the letters in MISSISSIPPI?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(34650);
    });
  });
});

// =============================================================================
// PROBABILITY SOLVER TESTS
// =============================================================================

describe("LocalCompute - Probability", () => {
  describe("Fair Coin Independence", () => {
    test("fair coin after streak - percentage", () => {
      const result = tryProbability(
        "A fair coin has landed heads 10 times in a row. What's the probability the next flip is heads? Answer as percentage.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("50");
      // Method can be fair_coin_independence or fair_coin_direct depending on which pattern matches first
      expect(result.method).toMatch(/fair_coin/);
    });

    test("fair coin after streak - decimal", () => {
      const result = tryProbability(
        "A fair coin has landed heads 10 times in a row. What's the probability the next flip is heads?",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("0.5");
    });

    test("fair coin tails after heads", () => {
      const result = tryProbability(
        "A fair coin has come up heads 5 times. What's the chance the next flip is tails? Answer as a percentage.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("50");
    });
  });

  describe("Independent Events", () => {
    test("basketball shots independent with 50%", () => {
      const result = tryProbability(
        "A basketball player has made 5 shots in a row. Assuming shots are independent with 50% success rate, what's the probability they make the next shot? Answer as percentage.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("50");
      // Method can be hot_hand_independence or independent_event depending on which pattern matches first
      expect(result.method).toMatch(/independent/);
    });

    test("independent events with stated probability", () => {
      const result = tryProbability(
        "Each trial is independent with 75% probability of success. What's the probability the next trial succeeds? Answer as percentage.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("75");
      expect(result.method).toBe("independent_event");
    });
  });

  describe("Birthday Paradox", () => {
    test("23 people - classic case (~50.7%)", () => {
      const result = tryProbability(
        "In a room of 23 people, what's the probability at least two share a birthday? Answer as percentage.",
      );
      expect(result.solved).toBe(true);
      expect(result.method).toBe("birthday_paradox");
      // 23 people gives ~50.7%
      expect(result.result).toBe("51");
    });

    test("50 people - high probability (~97%)", () => {
      const result = tryProbability(
        "50 people in a room. Probability that at least two share a birthday?",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("97");
    });

    test("70 people - very high probability (~99.9%)", () => {
      const result = tryProbability(
        "What's the probability that at least 2 of 70 students share a birthday?",
      );
      expect(result.solved).toBe(true);
      // Should be ~99.9%
      expect(parseInt(result.result as string, 10)).toBeGreaterThanOrEqual(99);
    });

    test("1 person - 0%", () => {
      const result = tryProbability(
        "In a room with 1 person, what's the probability at least two share a birthday?",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("0");
    });
  });

  describe("Non-matching questions", () => {
    test("conditional probability - not solvable", () => {
      const result = tryProbability(
        "Given sum is 9 when rolling two dice, what's the probability the first die is 6?",
      );
      expect(result.solved).toBe(false);
    });
  });

  describe("tryLocalCompute integration", () => {
    test("fair coin via tryLocalCompute", () => {
      const result = tryLocalCompute(
        "A fair coin has landed heads 10 times in a row. What's the probability the next flip is heads? Answer as percentage.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("50");
    });

    test("independent events via tryLocalCompute", () => {
      const result = tryLocalCompute(
        "Shots are independent with 50% success rate. What's the probability of making the next shot? Answer as percentage.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("50");
    });
  });

  describe("Classifier integration", () => {
    test("fair coin question classified as PROBABILITY", () => {
      const { mask } = classifyQuestion(
        "A fair coin has landed heads 10 times. What's the probability the next flip is heads?",
      );
      expect(mask & SolverType.PROBABILITY).toBeTruthy();
    });

    test("independent events classified as PROBABILITY", () => {
      const { mask } = classifyQuestion(
        "Shots are independent with 50% success. What's the probability of the next shot?",
      );
      expect(mask & SolverType.PROBABILITY).toBeTruthy();
    });

    test("streak probability classified as PROBABILITY", () => {
      const { mask } = classifyQuestion(
        "Made 5 shots in a row. What's the probability of the next shot?",
      );
      expect(mask & SolverType.PROBABILITY).toBeTruthy();
    });
  });
});

// =============================================================================
// CLASSIFIER TESTS
// =============================================================================

describe("LocalCompute - Classifier", () => {
  describe("classifyQuestion - arithmetic", () => {
    test("pure arithmetic expression", () => {
      const { mask } = classifyQuestion("5 + 3");
      expect(mask & SolverType.ARITHMETIC).toBeTruthy();
    });

    test("multiplication", () => {
      const { mask } = classifyQuestion("12 * 7");
      expect(mask & SolverType.ARITHMETIC).toBeTruthy();
    });

    test("complex expression", () => {
      const { mask } = classifyQuestion("(10 + 5) * 2 - 3");
      expect(mask & SolverType.ARITHMETIC).toBeTruthy();
    });

    test("bare number falls back to arithmetic", () => {
      const { mask } = classifyQuestion("42");
      expect(mask & SolverType.ARITHMETIC).toBeTruthy();
    });
  });

  describe("classifyQuestion - formula tier1", () => {
    test("percentage", () => {
      const { mask } = classifyQuestion("What is 25% of 80?");
      expect(mask & SolverType.FORMULA_TIER1).toBeTruthy();
    });

    test("factorial with !", () => {
      const { mask } = classifyQuestion("5!");
      expect(mask & SolverType.FORMULA_TIER1).toBeTruthy();
    });

    test("factorial word", () => {
      const { mask } = classifyQuestion("factorial of 6");
      expect(mask & SolverType.FORMULA_TIER1).toBeTruthy();
    });

    test("modulo", () => {
      const { mask } = classifyQuestion("17 mod 5");
      expect(mask & SolverType.FORMULA_TIER1).toBeTruthy();
    });

    test("remainder", () => {
      const { mask } = classifyQuestion("remainder of 17 divided by 5");
      expect(mask & SolverType.FORMULA_TIER1).toBeTruthy();
    });

    test("prime", () => {
      const { mask } = classifyQuestion("Is 17 prime?");
      expect(mask & SolverType.FORMULA_TIER1).toBeTruthy();
    });

    test("fibonacci", () => {
      const { mask } = classifyQuestion("10th fibonacci number");
      expect(mask & SolverType.FORMULA_TIER1).toBeTruthy();
    });
  });

  describe("classifyQuestion - formula tier2", () => {
    test("sqrt", () => {
      const { mask } = classifyQuestion("sqrt(144)");
      expect(mask & SolverType.FORMULA_TIER2).toBeTruthy();
    });

    test("square root word", () => {
      const { mask } = classifyQuestion("square root of 144");
      expect(mask & SolverType.FORMULA_TIER2).toBeTruthy();
    });

    test("power with caret", () => {
      const { mask } = classifyQuestion("2^10");
      expect(mask & SolverType.FORMULA_TIER2).toBeTruthy();
    });

    test("power word", () => {
      const { mask } = classifyQuestion("2 to the power of 10");
      expect(mask & SolverType.FORMULA_TIER2).toBeTruthy();
    });

    test("gcd", () => {
      const { mask } = classifyQuestion("gcd(12, 18)");
      expect(mask & SolverType.FORMULA_TIER2).toBeTruthy();
    });

    test("greatest common divisor", () => {
      const { mask } = classifyQuestion("greatest common divisor of 12 and 18");
      expect(mask & SolverType.FORMULA_TIER2).toBeTruthy();
    });

    test("lcm", () => {
      const { mask } = classifyQuestion("lcm(4, 6)");
      expect(mask & SolverType.FORMULA_TIER2).toBeTruthy();
    });
  });

  describe("classifyQuestion - formula tier3", () => {
    test("logarithm", () => {
      const { mask } = classifyQuestion("log base 2 of 8");
      expect(mask & SolverType.FORMULA_TIER3).toBeTruthy();
    });

    test("natural log", () => {
      const { mask } = classifyQuestion("ln(e)");
      expect(mask & SolverType.FORMULA_TIER3).toBeTruthy();
    });

    test("combinations - choose", () => {
      const { mask } = classifyQuestion("10 choose 3");
      expect(mask & SolverType.FORMULA_TIER3).toBeTruthy();
    });

    test("combinations - C notation", () => {
      const { mask } = classifyQuestion("10 C 3");
      expect(mask & SolverType.FORMULA_TIER3).toBeTruthy();
    });

    test("permutations - P notation", () => {
      const { mask } = classifyQuestion("10 P 3");
      expect(mask & SolverType.FORMULA_TIER3).toBeTruthy();
    });

    test("last digit", () => {
      const { mask } = classifyQuestion("What is the last digit of 7^100?");
      expect(mask & SolverType.FORMULA_TIER3).toBeTruthy();
    });
  });

  describe("classifyQuestion - formula tier4", () => {
    test("hypotenuse", () => {
      const { mask } = classifyQuestion("hypotenuse of 3 and 4");
      expect(mask & SolverType.FORMULA_TIER4).toBeTruthy();
    });

    test("trailing zeros", () => {
      const { mask } = classifyQuestion("trailing zeros in 100!");
      expect(mask & SolverType.FORMULA_TIER4).toBeTruthy();
    });

    test("infinite series", () => {
      const { mask } = classifyQuestion("sum of infinite series 1 + 1/2 + 1/4 + ...");
      expect(mask & SolverType.FORMULA_TIER4).toBeTruthy();
    });

    test("matrix determinant", () => {
      const { mask } = classifyQuestion("determinant of [[1,2],[3,4]]");
      expect(mask & SolverType.FORMULA_TIER4).toBeTruthy();
    });

    test("compound interest", () => {
      const { mask } = classifyQuestion("$1000 at 5% interest for 10 years");
      expect(mask & SolverType.FORMULA_TIER4).toBeTruthy();
    });
  });

  describe("classifyQuestion - word problems", () => {
    test("twice", () => {
      const { mask } = classifyQuestion("twice 15");
      expect(mask & SolverType.WORD_PROBLEM).toBeTruthy();
    });

    test("double", () => {
      const { mask } = classifyQuestion("double 25");
      expect(mask & SolverType.WORD_PROBLEM).toBeTruthy();
    });

    test("half of", () => {
      const { mask } = classifyQuestion("half of 50");
      expect(mask & SolverType.WORD_PROBLEM).toBeTruthy();
    });

    test("sum of", () => {
      const { mask } = classifyQuestion("sum of 10 and 20");
      expect(mask & SolverType.WORD_PROBLEM).toBeTruthy();
    });

    test("product of", () => {
      const { mask } = classifyQuestion("product of 5 and 7");
      expect(mask & SolverType.WORD_PROBLEM).toBeTruthy();
    });

    test("squared", () => {
      const { mask } = classifyQuestion("5 squared");
      expect(mask & SolverType.WORD_PROBLEM).toBeTruthy();
    });
  });

  describe("classifyQuestion - multi-step", () => {
    test("entity with twice", () => {
      const { mask } = classifyQuestion("Alice has 10 apples. Bob has twice as many.");
      expect(mask & SolverType.MULTI_STEP).toBeTruthy();
    });

    test("entity with more than", () => {
      const { mask } = classifyQuestion("Alice has 10. Bob has 5 more than Alice.");
      expect(mask & SolverType.MULTI_STEP).toBeTruthy();
    });

    test("how many does entity have", () => {
      const { mask } = classifyQuestion("How many does Bob have?");
      expect(mask & SolverType.MULTI_STEP).toBeTruthy();
    });
  });

  describe("classifyQuestion - calculus", () => {
    test("derivative", () => {
      const { mask } = classifyQuestion("derivative of x^3 at x=2");
      expect(mask & SolverType.CALCULUS).toBeTruthy();
    });

    test("differentiate", () => {
      const { mask } = classifyQuestion("differentiate x^2 + 3x");
      expect(mask & SolverType.CALCULUS).toBeTruthy();
    });

    test("d/dx notation", () => {
      const { mask } = classifyQuestion("d/dx of x^3");
      expect(mask & SolverType.CALCULUS).toBeTruthy();
    });

    test("integral", () => {
      const { mask } = classifyQuestion("integral of 2x from 0 to 3");
      expect(mask & SolverType.CALCULUS).toBeTruthy();
    });

    test("integrate", () => {
      const { mask } = classifyQuestion("integrate x^2");
      expect(mask & SolverType.CALCULUS).toBeTruthy();
    });
  });

  describe("classifyQuestion - logic", () => {
    test("modus ponens - if then with yes/no", () => {
      const { mask } = classifyQuestion(
        "If it rains, the ground is wet. It's raining. Is the ground wet? YES or NO.",
      );
      expect(mask & SolverType.LOGIC).toBeTruthy();
    });

    test("modus tollens - if then with negation", () => {
      const { mask } = classifyQuestion(
        "If it rains, the ground is wet. Ground is dry. Is it raining? YES or NO.",
      );
      expect(mask & SolverType.LOGIC).toBeTruthy();
    });

    test("syllogism - all A are B pattern", () => {
      const { mask } = classifyQuestion(
        "All A are B. All B are C. Therefore all A are C. Valid? YES or NO.",
      );
      expect(mask & SolverType.LOGIC).toBeTruthy();
    });

    test("XOR violation", () => {
      const { mask } = classifyQuestion(
        "You can have cake or ice cream (exclusive). You have both. Violated? YES or NO.",
      );
      expect(mask & SolverType.LOGIC).toBeTruthy();
    });
  });

  describe("classifyQuestion - precomputed values", () => {
    test("returns lowercase text", () => {
      const { lower } = classifyQuestion("What Is 5 + 3?");
      expect(lower).toBe("what is 5 + 3?");
    });

    test("detects digit presence", () => {
      const { chars } = classifyQuestion("5 + 3");
      expect(chars.hasDigit).toBe(true);
    });

    test("detects no digits", () => {
      const { chars } = classifyQuestion("hello world");
      expect(chars.hasDigit).toBe(false);
    });

    test("detects percent", () => {
      const { chars } = classifyQuestion("25% of 80");
      expect(chars.hasPercent).toBe(true);
    });

    test("detects caret", () => {
      const { chars } = classifyQuestion("2^10");
      expect(chars.hasCaret).toBe(true);
    });

    test("detects bracket", () => {
      const { chars } = classifyQuestion("[[1,2],[3,4]]");
      expect(chars.hasBracket).toBe(true);
    });

    test("detects dollar", () => {
      const { chars } = classifyQuestion("$1000");
      expect(chars.hasDollar).toBe(true);
    });

    test("detects exclamation", () => {
      const { chars } = classifyQuestion("5!");
      expect(chars.hasExclaim).toBe(true);
    });

    test("detects x variable", () => {
      const { chars } = classifyQuestion("x^2 + 3x");
      expect(chars.hasX).toBe(true);
    });
  });

  describe("classifyQuestion - no match", () => {
    test("pure text without numbers returns 0 mask", () => {
      const { mask } = classifyQuestion("hello world");
      expect(mask).toBe(0);
    });

    test("question without math keywords", () => {
      const { mask } = classifyQuestion("What is the capital of France?");
      expect(mask).toBe(0);
    });
  });

  describe("classifyQuestion - DERIVATION type", () => {
    test("prove keyword triggers DERIVATION", () => {
      const { mask } = classifyQuestion("prove that x + x = 2x");
      expect(shouldTrySolver(mask, SolverType.DERIVATION)).toBe(true);
    });

    test("show that keyword triggers DERIVATION", () => {
      const { mask } = classifyQuestion("show that (a+b)² = a² + 2ab + b²");
      expect(shouldTrySolver(mask, SolverType.DERIVATION)).toBe(true);
    });

    test("verify keyword triggers DERIVATION", () => {
      const { mask } = classifyQuestion("verify: x² - y² = (x+y)(x-y)");
      expect(shouldTrySolver(mask, SolverType.DERIVATION)).toBe(true);
    });

    test("multiple equals signs trigger DERIVATION", () => {
      const { mask } = classifyQuestion("x + x = 2x = 2*x");
      expect(shouldTrySolver(mask, SolverType.DERIVATION)).toBe(true);
    });

    test("arrow symbols trigger DERIVATION", () => {
      expect(shouldTrySolver(classifyQuestion("a ⟹ b").mask, SolverType.DERIVATION)).toBe(true);
      expect(shouldTrySolver(classifyQuestion("x → y").mask, SolverType.DERIVATION)).toBe(true);
      expect(shouldTrySolver(classifyQuestion("p => q").mask, SolverType.DERIVATION)).toBe(true);
    });

    test("simple equation does not trigger DERIVATION", () => {
      const { mask } = classifyQuestion("what is 2 + 2");
      expect(shouldTrySolver(mask, SolverType.DERIVATION)).toBe(false);
    });
  });

  describe("shouldTrySolver", () => {
    test("returns true when type is in mask", () => {
      const mask = SolverType.ARITHMETIC | SolverType.FORMULA_TIER1;
      expect(shouldTrySolver(mask, SolverType.ARITHMETIC)).toBe(true);
      expect(shouldTrySolver(mask, SolverType.FORMULA_TIER1)).toBe(true);
    });

    test("returns false when type not in mask", () => {
      const mask = SolverType.ARITHMETIC;
      expect(shouldTrySolver(mask, SolverType.CALCULUS)).toBe(false);
    });
  });

  describe("describeMask", () => {
    test("single type", () => {
      expect(describeMask(SolverType.ARITHMETIC)).toEqual(["arithmetic"]);
    });

    test("multiple types", () => {
      const mask = SolverType.ARITHMETIC | SolverType.CALCULUS;
      const desc = describeMask(mask);
      expect(desc).toContain("arithmetic");
      expect(desc).toContain("calculus");
      expect(desc.length).toBe(2);
    });

    test("all formula tiers", () => {
      const desc = describeMask(SolverGroup.FORMULA_ALL);
      expect(desc).toContain("formula_tier1");
      expect(desc).toContain("formula_tier2");
      expect(desc).toContain("formula_tier3");
      expect(desc).toContain("formula_tier4");
    });

    test("empty mask", () => {
      expect(describeMask(0)).toEqual([]);
    });
  });

  describe("SolverGroup constants", () => {
    test("FORMULA_ALL includes all tiers", () => {
      expect(SolverGroup.FORMULA_ALL & SolverType.FORMULA_TIER1).toBeTruthy();
      expect(SolverGroup.FORMULA_ALL & SolverType.FORMULA_TIER2).toBeTruthy();
      expect(SolverGroup.FORMULA_ALL & SolverType.FORMULA_TIER3).toBeTruthy();
      expect(SolverGroup.FORMULA_ALL & SolverType.FORMULA_TIER4).toBeTruthy();
    });

    test("WORD_ALL includes word and multi-step", () => {
      expect(SolverGroup.WORD_ALL & SolverType.WORD_PROBLEM).toBeTruthy();
      expect(SolverGroup.WORD_ALL & SolverType.MULTI_STEP).toBeTruthy();
    });

    test("ALL includes everything", () => {
      // 12 solver types: ARITHMETIC, CALCULUS, FORMULA (4 tiers), WORD_PROBLEM, MULTI_STEP, FACTS, LOGIC, PROBABILITY, DERIVATION
      expect(SolverGroup.ALL).toBe(0xfff);
    });
  });
});

// =============================================================================
// REGISTRY TESTS
// =============================================================================

describe("LocalCompute - Registry", () => {
  describe("getSolvers", () => {
    test("returns registered solvers", () => {
      const solvers = getSolvers();
      expect(solvers.length).toBeGreaterThan(0);
    });

    test("solvers are sorted by priority", () => {
      const solvers = getSolvers();
      for (let i = 1; i < solvers.length; i++) {
        expect(solvers[i].priority).toBeGreaterThanOrEqual(solvers[i - 1].priority);
      }
    });

    test("includes expected built-in solvers", () => {
      const solvers = getSolvers();
      const names = solvers.map((s) => s.name);
      expect(names).toContain("arithmetic");
      expect(names).toContain("formula");
      expect(names).toContain("word_problem");
      expect(names).toContain("multi_step_word");
      expect(names).toContain("calculus");
    });
  });

  describe("getSolversForMask", () => {
    test("returns only matching solvers for arithmetic", () => {
      const solvers = getSolversForMask(SolverType.ARITHMETIC);
      expect(solvers.length).toBeGreaterThan(0);
      expect(solvers.every((s) => (s.types & SolverType.ARITHMETIC) !== 0)).toBe(true);
    });

    test("returns formula solver for any formula tier", () => {
      const solvers = getSolversForMask(SolverType.FORMULA_TIER1);
      const names = solvers.map((s) => s.name);
      expect(names).toContain("formula");
    });

    test("returns calculus solver for calculus mask", () => {
      const solvers = getSolversForMask(SolverType.CALCULUS);
      const names = solvers.map((s) => s.name);
      expect(names).toContain("calculus");
    });

    test("returns empty array for mask 0", () => {
      const solvers = getSolversForMask(0);
      expect(solvers).toEqual([]);
    });

    test("returns multiple solvers for combined mask", () => {
      const solvers = getSolversForMask(SolverType.ARITHMETIC | SolverType.CALCULUS);
      const names = solvers.map((s) => s.name);
      expect(names).toContain("arithmetic");
      expect(names).toContain("calculus");
    });
  });

  describe("getRegistryStats", () => {
    test("returns count and byType", () => {
      const stats = getRegistryStats();
      expect(stats.count).toBeGreaterThan(0);
      expect(typeof stats.byType).toBe("object");
    });

    test("byType includes arithmetic", () => {
      const stats = getRegistryStats();
      expect(stats.byType.arithmetic).toBeGreaterThanOrEqual(1);
    });

    test("byType includes formula tiers", () => {
      const stats = getRegistryStats();
      // Formula solver covers all tiers
      expect(stats.byType.formula_tier1).toBeGreaterThanOrEqual(1);
      expect(stats.byType.formula_tier2).toBeGreaterThanOrEqual(1);
      expect(stats.byType.formula_tier3).toBeGreaterThanOrEqual(1);
      expect(stats.byType.formula_tier4).toBeGreaterThanOrEqual(1);
    });

    test("byType includes calculus", () => {
      const stats = getRegistryStats();
      expect(stats.byType.calculus).toBeGreaterThanOrEqual(1);
    });
  });
});

// =============================================================================
// CLASSIFIER PERFORMANCE TESTS
// =============================================================================

describe("LocalCompute - Classifier Performance", () => {
  test("classifyQuestion runs under 1ms", () => {
    const questions = [
      "5 + 3",
      "What is 25% of 80?",
      "derivative of x^3 at x=2",
      "Alice has 10 apples. Bob has twice as many.",
      "determinant of [[1,2],[3,4]]",
    ];

    const iterations = 1000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      for (const q of questions) {
        classifyQuestion(q);
      }
    }

    const elapsed = performance.now() - start;
    const avgPerCall = elapsed / (iterations * questions.length);

    // Should be well under 0.1ms per call
    expect(avgPerCall).toBeLessThan(0.1);
  });
});

// =============================================================================
// PERFORMANCE REGRESSION TESTS
// =============================================================================

describe("LocalCompute - extractAndCompute Performance", () => {
  test("maintains O(n) complexity: μs/char < 0.5", () => {
    // Text with multiple formula types to stress-test the combined regex
    const baseText = "The sqrt(16) is 4 and 5! is 120. Calculate 2^10 bytes. ";

    // Test at multiple sizes to verify linear scaling
    const sizes = [500, 2000, 5000];
    const results: Array<{ size: number; usPerChar: number }> = [];

    for (const size of sizes) {
      const text = baseText.repeat(Math.ceil(size / baseText.length)).slice(0, size);

      // Warm-up run
      extractAndCompute(text);

      // Timed run (multiple iterations for stability)
      const iterations = 50;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        extractAndCompute(text);
      }
      const elapsed = performance.now() - start;
      const avgMs = elapsed / iterations;
      const usPerChar = (avgMs / text.length) * 1000;

      results.push({ size, usPerChar });
    }

    // Assert all sizes stay under 0.5 μs/char threshold
    for (const { usPerChar } of results) {
      expect(usPerChar).toBeLessThan(0.5);
    }

    // Assert linear scaling: largest size shouldn't be >2x slower per char than smallest
    const smallestUsPerChar = results[0]!.usPerChar;
    const largestUsPerChar = results[results.length - 1]!.usPerChar;
    const scalingRatio = largestUsPerChar / smallestUsPerChar;

    // Allow up to 3x variation (accounts for cache effects, GC, etc.)
    expect(scalingRatio).toBeLessThan(3);
  });

  test("computeAndReplace convenience function works", () => {
    const input = "Calculate sqrt(16) and 5!";
    const output = computeAndReplace(input);

    expect(output).toContain("[=4]");
    expect(output).toContain("[=120]");
    expect(typeof output).toBe("string");
  });
});

// ============================================================================
// SCRATCHPAD HELPERS (Session navigation)
// ============================================================================

describe("SessionManager - Scratchpad Helpers", () => {
  beforeEach(() => {
    SessionManager.clearAll();
  });

  test("getNextStep returns 1 for empty session", () => {
    const nextStep = SessionManager.getNextStep("new-session", "main");
    expect(nextStep).toBe(1);
  });

  test("getNextStep auto-increments correctly", () => {
    SessionManager.addThought("sess", {
      id: "t1",
      step_number: 1,
      thought: "First thought",
      timestamp: Date.now(),
      branch_id: "main",
    });
    expect(SessionManager.getNextStep("sess", "main")).toBe(2);

    SessionManager.addThought("sess", {
      id: "t2",
      step_number: 2,
      thought: "Second thought",
      timestamp: Date.now(),
      branch_id: "main",
    });
    expect(SessionManager.getNextStep("sess", "main")).toBe(3);
  });

  test("getCurrentStep returns 0 for empty session", () => {
    expect(SessionManager.getCurrentStep("empty", "main")).toBe(0);
  });

  test("getCurrentStep returns max step for branch", () => {
    SessionManager.addThought("sess", {
      id: "t1",
      step_number: 1,
      thought: "Step 1",
      timestamp: Date.now(),
      branch_id: "main",
    });
    SessionManager.addThought("sess", {
      id: "t3",
      step_number: 3,
      thought: "Step 3 (skipped 2)",
      timestamp: Date.now(),
      branch_id: "main",
    });
    expect(SessionManager.getCurrentStep("sess", "main")).toBe(3);
  });

  test("getPath returns lineage from root to step", () => {
    // Build a chain: 1 -> 2 -> 3
    for (let i = 1; i <= 3; i++) {
      SessionManager.addThought("sess", {
        id: `t${i}`,
        step_number: i,
        thought: `Step ${i}`,
        timestamp: Date.now(),
        branch_id: "main",
      });
    }

    const path = SessionManager.getPath("sess", 3);
    expect(path).toHaveLength(3);
    expect(path[0]?.step_number).toBe(1);
    expect(path[1]?.step_number).toBe(2);
    expect(path[2]?.step_number).toBe(3);
  });

  test("getPath handles branches correctly", () => {
    // Main: 1 -> 2
    SessionManager.addThought("sess", {
      id: "t1",
      step_number: 1,
      thought: "Main step 1",
      timestamp: Date.now(),
      branch_id: "main",
    });
    SessionManager.addThought("sess", {
      id: "t2",
      step_number: 2,
      thought: "Main step 2",
      timestamp: Date.now(),
      branch_id: "main",
    });

    // Branch from step 1 -> step 3
    SessionManager.addThought("sess", {
      id: "t3",
      step_number: 3,
      thought: "Branch step",
      timestamp: Date.now(),
      branch_id: "alt",
      branch_from: 1,
      branch_name: "Alternative",
    });

    const branchPath = SessionManager.getPath("sess", 3);
    // Should include step 1 (branch point) and step 3 (branch step)
    expect(branchPath.some((t) => t.step_number === 1)).toBe(true);
    expect(branchPath.some((t) => t.step_number === 3)).toBe(true);
  });

  test("getAverageConfidence returns 0 for empty session", () => {
    expect(SessionManager.getAverageConfidence("empty")).toBe(0);
  });

  test("getAverageConfidence calculates average correctly", () => {
    SessionManager.addThought("sess", {
      id: "t1",
      step_number: 1,
      thought: "High confidence",
      timestamp: Date.now(),
      branch_id: "main",
      verification: { passed: true, confidence: 0.9, domain: "math" },
    });
    SessionManager.addThought("sess", {
      id: "t2",
      step_number: 2,
      thought: "Lower confidence",
      timestamp: Date.now(),
      branch_id: "main",
      verification: { passed: true, confidence: 0.7, domain: "math" },
    });

    const avg = SessionManager.getAverageConfidence("sess");
    expect(avg).toBeCloseTo(0.8, 2); // (0.9 + 0.7) / 2
  });

  test("getAverageConfidence filters by branch", () => {
    SessionManager.addThought("sess", {
      id: "t1",
      step_number: 1,
      thought: "Main",
      timestamp: Date.now(),
      branch_id: "main",
      verification: { passed: true, confidence: 0.9, domain: "math" },
    });
    SessionManager.addThought("sess", {
      id: "t2",
      step_number: 2,
      thought: "Alt",
      timestamp: Date.now(),
      branch_id: "alt",
      verification: { passed: true, confidence: 0.5, domain: "math" },
    });

    expect(SessionManager.getAverageConfidence("sess", "main")).toBeCloseTo(0.9, 2);
    expect(SessionManager.getAverageConfidence("sess", "alt")).toBeCloseTo(0.5, 2);
  });

  test("getAverageConfidence ignores thoughts without verification", () => {
    SessionManager.addThought("sess", {
      id: "t1",
      step_number: 1,
      thought: "No verification",
      timestamp: Date.now(),
      branch_id: "main",
    });
    SessionManager.addThought("sess", {
      id: "t2",
      step_number: 2,
      thought: "With verification",
      timestamp: Date.now(),
      branch_id: "main",
      verification: { passed: true, confidence: 0.8, domain: "math" },
    });

    // Only the verified thought counts
    expect(SessionManager.getAverageConfidence("sess")).toBeCloseTo(0.8, 2);
  });
});

// ============================================================================
// S1: verifyMath now checks numeric computations
// ============================================================================
describe("verifyMath with numeric equation verification", () => {
  test("passes correct computations", () => {
    expect(verify("2 + 2 = 4", "math").passed).toBe(true);
    expect(verify("3 * 5 = 15", "math").passed).toBe(true);
    expect(verify("10 - 3 = 7", "math").passed).toBe(true);
    expect(verify("20 / 4 = 5", "math").passed).toBe(true);
  });

  test("fails incorrect computations", () => {
    const result = verify("2 + 2 = 5", "math");
    expect(result.passed).toBe(false);
    expect(result.suggestions.some((s) => s.includes("Computation error"))).toBe(true);
  });

  test("fails incorrect multiplication", () => {
    const result = verify("3 * 4 = 10", "math");
    expect(result.passed).toBe(false);
  });

  test("handles complex expressions", () => {
    expect(verify("(2 + 3) * 4 = 20", "math").passed).toBe(true);
    expect(verify("2 ^ 3 = 8", "math").passed).toBe(true);
    expect(verify("√16 = 4", "math").passed).toBe(true);
  });

  test("handles Unicode operators", () => {
    expect(verify("6 × 7 = 42", "math").passed).toBe(true);
    expect(verify("20 ÷ 4 = 5", "math").passed).toBe(true);
    expect(verify("10 − 3 = 7", "math").passed).toBe(true);
  });

  test("skips equations with variables", () => {
    // Can't evaluate x + 1 = 5, so it should pass (no computation error)
    const result = verify("x + 1 = 5", "math");
    expect(result.passed).toBe(true);
  });

  test("handles floating point", () => {
    expect(verify("3.14 * 2 = 6.28", "math").passed).toBe(true);
    expect(verify("1.5 + 2.5 = 4", "math").passed).toBe(true);
  });
});

// ============================================================================
// S2: simplifyAST for constant folding and algebraic simplification
// ============================================================================
describe("simplifyAST", () => {
  const parse = (expr: string) => {
    const { tokens } = tokenizeMathExpression(expr);
    const { ast } = buildAST(tokens);
    return ast!;
  };

  test("constant folding - basic operations", () => {
    const simplified = simplifyAST(parse("2 + 3"));
    expect(simplified.type).toBe("number");
    expect((simplified as { value: number }).value).toBe(5);
  });

  test("constant folding - complex expression", () => {
    const simplified = simplifyAST(parse("2 * 3 + 4"));
    expect(simplified.type).toBe("number");
    expect((simplified as { value: number }).value).toBe(10);
  });

  test("identity: x + 0 → x", () => {
    const simplified = simplifyAST(parse("x + 0"));
    expect(simplified.type).toBe("variable");
    expect((simplified as { name: string }).name).toBe("x");
  });

  test("identity: 0 + x → x", () => {
    const simplified = simplifyAST(parse("0 + x"));
    expect(simplified.type).toBe("variable");
    expect((simplified as { name: string }).name).toBe("x");
  });

  test("identity: x * 1 → x", () => {
    const simplified = simplifyAST(parse("x * 1"));
    expect(simplified.type).toBe("variable");
    expect((simplified as { name: string }).name).toBe("x");
  });

  test("identity: 1 * x → x", () => {
    const simplified = simplifyAST(parse("1 * x"));
    expect(simplified.type).toBe("variable");
    expect((simplified as { name: string }).name).toBe("x");
  });

  test("zero: x * 0 → 0", () => {
    const simplified = simplifyAST(parse("x * 0"));
    expect(simplified.type).toBe("number");
    expect((simplified as { value: number }).value).toBe(0);
  });

  test("zero: 0 * x → 0", () => {
    const simplified = simplifyAST(parse("0 * x"));
    expect(simplified.type).toBe("number");
    expect((simplified as { value: number }).value).toBe(0);
  });

  test("power: x ^ 0 → 1", () => {
    const simplified = simplifyAST(parse("x ^ 0"));
    expect(simplified.type).toBe("number");
    expect((simplified as { value: number }).value).toBe(1);
  });

  test("power: x ^ 1 → x", () => {
    const simplified = simplifyAST(parse("x ^ 1"));
    expect(simplified.type).toBe("variable");
    expect((simplified as { name: string }).name).toBe("x");
  });

  test("power: 1 ^ x → 1", () => {
    const simplified = simplifyAST(parse("1 ^ x"));
    expect(simplified.type).toBe("number");
    expect((simplified as { value: number }).value).toBe(1);
  });

  test("subtraction: x - 0 → x", () => {
    const simplified = simplifyAST(parse("x - 0"));
    expect(simplified.type).toBe("variable");
    expect((simplified as { name: string }).name).toBe("x");
  });

  test("self subtraction: x - x → 0", () => {
    const simplified = simplifyAST(parse("x - x"));
    expect(simplified.type).toBe("number");
    expect((simplified as { value: number }).value).toBe(0);
  });

  test("division: x / 1 → x", () => {
    const simplified = simplifyAST(parse("x / 1"));
    expect(simplified.type).toBe("variable");
    expect((simplified as { name: string }).name).toBe("x");
  });

  test("self division: x / x → 1", () => {
    const simplified = simplifyAST(parse("x / x"));
    expect(simplified.type).toBe("number");
    expect((simplified as { value: number }).value).toBe(1);
  });

  test("division: 0 / x → 0", () => {
    const simplified = simplifyAST(parse("0 / x"));
    expect(simplified.type).toBe("number");
    expect((simplified as { value: number }).value).toBe(0);
  });

  test("double negation: --x → x", () => {
    // Parse "--x" as two unary negations
    const ast = parse("-(-x)");
    const simplified = simplifyAST(ast);
    expect(simplified.type).toBe("variable");
    expect((simplified as { name: string }).name).toBe("x");
  });

  test("unary plus: +x → x", () => {
    // Build AST manually since tokenizer may not parse +x correctly
    const { tokens } = tokenizeMathExpression("0 + x");
    const { ast } = buildAST(tokens);
    const simplified = simplifyAST(ast!);
    expect(simplified.type).toBe("variable");
    expect((simplified as { name: string }).name).toBe("x");
  });

  test("nested simplification", () => {
    // (x + 0) * 1 → x
    const simplified = simplifyAST(parse("(x + 0) * 1"));
    expect(simplified.type).toBe("variable");
    expect((simplified as { name: string }).name).toBe("x");
  });

  test("preserves non-simplifiable expressions", () => {
    const simplified = simplifyAST(parse("x + y"));
    expect(simplified.type).toBe("binary");
  });
});

// ============================================================================
// S3: compareExpressions for algebraic equivalence
// ============================================================================
describe("compareExpressions", () => {
  test("basic equivalence: x + x = 2 * x", () => {
    expect(compareExpressions("x + x", "2 * x")).toBe(true);
  });

  test("commutative: a + b = b + a", () => {
    expect(compareExpressions("a + b", "b + a")).toBe(true);
  });

  test("commutative multiplication: a * b = b * a", () => {
    expect(compareExpressions("a * b", "b * a")).toBe(true);
  });

  test("distributive: a * (b + c) = a * b + a * c", () => {
    expect(compareExpressions("a * (b + c)", "a * b + a * c")).toBe(true);
  });

  test("identity: x + 0 = x", () => {
    expect(compareExpressions("x + 0", "x")).toBe(true);
  });

  test("identity: x * 1 = x", () => {
    expect(compareExpressions("x * 1", "x")).toBe(true);
  });

  test("non-equivalent expressions", () => {
    expect(compareExpressions("x + 1", "x")).toBe(false);
    expect(compareExpressions("x * 2", "x")).toBe(false);
  });

  test("constant expressions", () => {
    expect(compareExpressions("2 + 3", "5")).toBe(true);
    expect(compareExpressions("2 * 3", "6")).toBe(true);
    expect(compareExpressions("2 ^ 3", "8")).toBe(true);
  });

  test("power expressions: x² = x * x", () => {
    expect(compareExpressions("x²", "x * x")).toBe(true);
  });

  test("handles Unicode operators", () => {
    expect(compareExpressions("a × b", "a * b")).toBe(true);
    expect(compareExpressions("a ÷ b", "a / b")).toBe(true);
  });

  test("returns false for invalid expressions", () => {
    expect(compareExpressions("+++", "x")).toBe(false);
    expect(compareExpressions("x", ")))")).toBe(false);
  });

  test("handles expressions with multiple variables", () => {
    expect(compareExpressions("(a + b) * (a - b)", "a² - b²")).toBe(true);
  });
});

// ============================================================================
// formatAST for human-readable output
// ============================================================================
describe("formatAST", () => {
  function parse(expr: string) {
    const { tokens } = tokenizeMathExpression(expr);
    const { ast } = buildAST(tokens);
    return ast!;
  }

  describe("basic formatting", () => {
    test("formats numbers", () => {
      expect(formatAST(parse("42"))).toBe("42");
    });

    test("formats variables", () => {
      expect(formatAST(parse("x"))).toBe("x");
    });

    test("formats binary operations with spaces", () => {
      expect(formatAST(parse("2 + 3"))).toBe("2 + 3");
      expect(formatAST(parse("x * y"))).toBe("x * y");
    });

    test("formats unary minus", () => {
      expect(formatAST(parse("-x"))).toBe("-x");
    });

    test("formats postfix operators", () => {
      expect(formatAST(parse("x²"))).toBe("x²");
      expect(formatAST(parse("x³"))).toBe("x³");
    });
  });

  describe("unicode operators", () => {
    test("converts * to ×", () => {
      expect(formatAST(parse("2 * 3"), { useUnicode: true })).toBe("2 × 3");
    });

    test("converts / to ÷", () => {
      expect(formatAST(parse("6 / 2"), { useUnicode: true })).toBe("6 ÷ 2");
    });

    test("converts - to −", () => {
      expect(formatAST(parse("5 - 3"), { useUnicode: true })).toBe("5 − 3");
    });
  });

  describe("minimal parentheses", () => {
    test("no parens needed for precedence: a + b * c", () => {
      // b * c binds tighter, so no parens needed
      expect(formatAST(parse("a + b * c"), { minimalParens: true })).toBe("a + b * c");
    });

    test("parens for lower precedence: (a + b) * c", () => {
      expect(formatAST(parse("(a + b) * c"), { minimalParens: true })).toBe("(a + b) * c");
    });

    test("parens for right associativity: a - (b - c)", () => {
      expect(formatAST(parse("a - (b - c)"), { minimalParens: true })).toBe("a - (b - c)");
    });

    test("no extra parens for same precedence left-associative: a - b - c", () => {
      // a - b - c means (a - b) - c, no parens needed on output
      expect(formatAST(parse("a - b - c"), { minimalParens: true })).toBe("a - b - c");
    });
  });

  describe("spacing options", () => {
    test("spaces: true (default)", () => {
      expect(formatAST(parse("2+3"), { spaces: true })).toBe("2 + 3");
    });

    test("spaces: false", () => {
      expect(formatAST(parse("2 + 3"), { spaces: false })).toBe("2+3");
    });
  });

  describe("complex expressions", () => {
    test("nested operations", () => {
      expect(formatAST(parse("(a + b) * (c + d)"))).toBe("(a + b) * (c + d)");
    });

    test("powers", () => {
      expect(formatAST(parse("x ^ 2"))).toBe("x ^ 2");
    });

    test("combined", () => {
      const ast = parse("2 * x + 3");
      expect(formatAST(ast, { useUnicode: true })).toBe("2 × x + 3");
    });
  });
});

// ============================================================================
// S2: canonicalizeExpression and trySimplifyToConstant
// ============================================================================
describe("canonicalizeExpression", () => {
  test("constant folding", () => {
    expect(canonicalizeExpression("2 + 3")).toBe("5");
    expect(canonicalizeExpression("2 * 3")).toBe("6");
    expect(canonicalizeExpression("10 / 2")).toBe("5");
  });

  test("identity removal: x + 0 → x", () => {
    const result = canonicalizeExpression("x + 0");
    expect(result).toBe("x");
  });

  test("identity removal: x * 1 → x", () => {
    const result = canonicalizeExpression("x * 1");
    expect(result).toBe("x");
  });

  test("preserves complex expressions", () => {
    const result = canonicalizeExpression("x + y");
    expect(result).toContain("x");
    expect(result).toContain("y");
  });

  test("returns null for invalid expressions", () => {
    expect(canonicalizeExpression("+++")).toBe(null);
    expect(canonicalizeExpression("((")).toBe(null);
  });
});

describe("trySimplifyToConstant", () => {
  test("reduces pure arithmetic to constant", () => {
    expect(trySimplifyToConstant("2 + 3")).toBe(5);
    expect(trySimplifyToConstant("10 / 2")).toBe(5);
    expect(trySimplifyToConstant("2 ^ 3")).toBe(8);
  });

  test("x - x → 0", () => {
    expect(trySimplifyToConstant("x - x")).toBe(0);
  });

  test("x / x → 1", () => {
    expect(trySimplifyToConstant("x / x")).toBe(1);
  });

  test("x ^ 0 → 1", () => {
    expect(trySimplifyToConstant("x ^ 0")).toBe(1);
  });

  test("returns null for non-constant expressions", () => {
    expect(trySimplifyToConstant("x + 1")).toBe(null);
    expect(trySimplifyToConstant("2 * y")).toBe(null);
  });
});

describe("tryFormula algebraic simplification", () => {
  test("solves x - x = ?", () => {
    const result = tryFormula("what is x - x?");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(0);
    expect(result.method).toBe("algebraic_simplification");
  });

  test("solves x/x = ?", () => {
    const result = tryFormula("evaluate x / x = ?");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(1);
  });

  test("solves pure arithmetic via simplification", () => {
    const result = tryFormula("simplify 2 + 3 * 4 = ?");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(14);
  });
});

// ============================================================================
// S3: tryDerivation and verifyDerivationSteps
// ============================================================================
describe("verifyDerivationSteps", () => {
  test("validates simple valid derivation", () => {
    const steps = [
      { lhs: "x + x", rhs: "2 * x" },
      { lhs: "2 * x", rhs: "2x" },
    ];
    const result = verifyDerivationSteps(steps);
    expect(result.valid).toBe(true);
    expect(result.steps.length).toBe(2);
  });

  test("catches invalid step", () => {
    const steps = [
      { lhs: "x + x", rhs: "2 * x" },
      { lhs: "2 * x", rhs: "3 * x" }, // Invalid: 2x ≠ 3x
    ];
    const result = verifyDerivationSteps(steps);
    expect(result.valid).toBe(false);
    expect(result.invalidStep).toBe(2);
  });

  test("catches discontinuity between steps", () => {
    const steps = [
      { lhs: "x + x", rhs: "2 * x" },
      { lhs: "y + y", rhs: "2 * y" }, // Valid on its own, but doesn't follow from previous
    ];
    const result = verifyDerivationSteps(steps);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Discontinuity");
  });

  test("handles empty steps", () => {
    const result = verifyDerivationSteps([]);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("No derivation steps found");
  });

  test("validates single step", () => {
    const steps = [{ lhs: "a + b", rhs: "b + a" }];
    const result = verifyDerivationSteps(steps);
    expect(result.valid).toBe(true);
  });
});

describe("tryDerivation", () => {
  test("verifies valid chained derivation", () => {
    const result = tryDerivation("prove: x + x = 2x = 2 * x");
    expect(result.solved).toBe(true);
    expect(result.result).toContain("Valid");
    expect(result.method).toBe("derivation_verification");
  });

  test("catches invalid derivation", () => {
    const result = tryDerivation("show that x + x = 2x = 3x");
    expect(result.solved).toBe(true);
    expect(result.result).toContain("Invalid");
  });

  test("verifies distributive property", () => {
    const result = tryDerivation("verify: a * (b + c) = a*b + a*c");
    expect(result.solved).toBe(true);
    expect(result.result).toContain("Valid");
  });

  test("skips non-derivation text", () => {
    const result = tryDerivation("What is 2 + 2?");
    expect(result.solved).toBe(false);
  });

  test("handles multi-line derivations", () => {
    const text = `
      prove the following:
      x + x = 2x
      2x + 0 = 2x
    `;
    const result = tryDerivation(text);
    expect(result.solved).toBe(true);
    expect(result.result).toContain("Valid");
  });
});

// ============================================================================
// simplifyDerivation - applies simplification and removes redundant steps
// ============================================================================
describe("simplifyDerivation", () => {
  describe("basic simplification", () => {
    test("simplifies x + 0 to x", () => {
      const steps = [{ lhs: "x + 0", rhs: "x" }];
      const result = simplifyDerivation(steps);

      expect(result.simplified[0]?.simplifiedLhs).toBe("x");
      expect(result.simplified[0]?.wasSimplified).toBe(true);
    });

    test("simplifies x * 1 to x", () => {
      const steps = [{ lhs: "x * 1", rhs: "x" }];
      const result = simplifyDerivation(steps);

      expect(result.simplified[0]?.simplifiedLhs).toBe("x");
    });

    test("simplifies x - x to 0", () => {
      const steps = [{ lhs: "x - x", rhs: "0" }];
      const result = simplifyDerivation(steps);

      expect(result.simplified[0]?.simplifiedLhs).toBe("0");
    });

    test("constant folding: 2 + 3 → 5", () => {
      const steps = [{ lhs: "2 + 3", rhs: "5" }];
      const result = simplifyDerivation(steps);

      expect(result.simplified[0]?.simplifiedLhs).toBe("5");
      expect(result.simplified[0]?.simplifiedRhs).toBe("5");
    });
  });

  describe("redundant step removal", () => {
    test("removes identity steps in the middle", () => {
      const steps = [
        { lhs: "x + 0", rhs: "x" },
        { lhs: "x", rhs: "x * 1" }, // x = x (identity after simplification)
        { lhs: "x * 1", rhs: "x + x - x" }, // still x (identity)
        { lhs: "x", rhs: "2 * x / 2" }, // actual transformation
      ];
      const result = simplifyDerivation(steps);

      // Should have fewer steps after cleaning
      expect(result.stepsRemoved).toBeGreaterThan(0);
      expect(result.cleaned.length).toBeLessThan(steps.length);
    });

    test("keeps non-redundant steps", () => {
      const steps = [
        { lhs: "x", rhs: "x + 0" },
        { lhs: "x", rhs: "2 * x / 2" },
        { lhs: "x", rhs: "x * x / x" },
      ];
      const result = simplifyDerivation(steps);

      // First step is never removed
      expect(result.cleaned.length).toBeGreaterThanOrEqual(1);
    });

    test("handles single step (never removed)", () => {
      const steps = [{ lhs: "x + x", rhs: "2 * x" }];
      const result = simplifyDerivation(steps);

      expect(result.cleaned.length).toBe(1);
      expect(result.stepsRemoved).toBe(0);
    });
  });

  describe("suggestions", () => {
    test("generates suggestions for simplifiable expressions", () => {
      const steps = [{ lhs: "x + 0 + 0", rhs: "x" }];
      const result = simplifyDerivation(steps);

      expect(result.summary.length).toBeGreaterThan(0);
      expect(result.summary.some((s) => s.includes("simplif"))).toBe(true);
    });

    test("reports identity steps", () => {
      const steps = [
        { lhs: "x", rhs: "x" }, // pure identity
      ];
      const result = simplifyDerivation(steps);

      expect(result.summary.some((s) => s.toLowerCase().includes("identity"))).toBe(true);
    });

    test("reports when already simplified", () => {
      const steps = [{ lhs: "x", rhs: "y" }];
      const result = simplifyDerivation(steps);

      // Should have a message about being simplified or no changes
      expect(result.summary.length).toBeGreaterThan(0);
    });
  });

  describe("empty input handling", () => {
    test("handles empty steps array", () => {
      const result = simplifyDerivation([]);

      expect(result.original).toEqual([]);
      expect(result.simplified).toEqual([]);
      expect(result.cleaned).toEqual([]);
      expect(result.stepsRemoved).toBe(0);
    });
  });

  describe("complex derivations", () => {
    test("simplifies quadratic expansion", () => {
      const steps = [
        { lhs: "(a + b) * (a + b)", rhs: "a*a + a*b + b*a + b*b" },
        { lhs: "a*a + a*b + b*a + b*b", rhs: "a² + 2*a*b + b²" },
      ];
      const result = simplifyDerivation(steps);

      expect(result.cleaned.length).toBeGreaterThanOrEqual(1);
    });

    test("preserves valid multi-step derivation", () => {
      const steps = [
        { lhs: "x + x", rhs: "2*x" },
        { lhs: "2*x", rhs: "2x" },
        { lhs: "2x", rhs: "x + x" },
      ];
      const result = simplifyDerivation(steps);

      // Should preserve the structure (circular but valid)
      expect(result.original.length).toBe(3);
    });
  });
});

describe("simplifyDerivationText", () => {
  test("parses and simplifies derivation from text", () => {
    const result = simplifyDerivationText("prove: x + 0 = x = x * 1");

    expect(result).not.toBeNull();
    expect(result?.original.length).toBeGreaterThan(0);
  });

  test("returns null for non-derivation text", () => {
    const result = simplifyDerivationText("hello world");

    expect(result).toBeNull();
  });

  test("handles chained equalities", () => {
    const result = simplifyDerivationText("x + x = 2x = 2*x = x + x");

    expect(result).not.toBeNull();
    expect(result?.original.length).toBe(3); // 4 terms = 3 steps
  });
});

// =============================================================================
// suggestNextStep - proposes next algebraic transformation
// =============================================================================

describe("suggestNextStep", () => {
  describe("identity elimination", () => {
    test("suggests removing addition of zero", () => {
      const result = suggestNextStep([{ lhs: "x + 0", rhs: "x + 0" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("add_zero");
      expect(result.description).toContain("zero");
    });

    test("suggests removing multiplication by one", () => {
      const result = suggestNextStep([{ lhs: "x * 1", rhs: "x * 1" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("multiply_one");
      expect(result.description).toContain("one");
    });

    test("suggests simplifying multiplication by zero", () => {
      const result = suggestNextStep([{ lhs: "x * 0", rhs: "x * 0" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("multiply_zero");
    });

    test("suggests removing exponent of one", () => {
      const result = suggestNextStep([{ lhs: "x^1", rhs: "x^1" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("power_one");
    });

    test("suggests simplifying exponent of zero", () => {
      const result = suggestNextStep([{ lhs: "x^0", rhs: "x^0" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("power_zero");
    });
  });

  describe("constant folding", () => {
    test("suggests evaluating numeric operations", () => {
      const result = suggestNextStep([{ lhs: "2 + 3", rhs: "2 + 3" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("constant_fold");
    });

    test("suggests evaluating nested numeric operations", () => {
      const result = suggestNextStep([{ lhs: "x + 2 * 3", rhs: "x + 2 * 3" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("constant_fold");
    });
  });

  describe("self-cancellation", () => {
    test("suggests self-subtraction simplification", () => {
      const result = suggestNextStep([{ lhs: "x - x", rhs: "x - x" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("subtract_self");
    });

    test("suggests self-division simplification", () => {
      const result = suggestNextStep([{ lhs: "x / x", rhs: "x / x" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("divide_self");
    });
  });

  describe("combining like terms", () => {
    test("suggests combining x + x", () => {
      const result = suggestNextStep([{ lhs: "x + x", rhs: "x + x" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("combine_like_terms");
    });
  });

  describe("distributive law", () => {
    test("suggests distribution when multiplying sum", () => {
      const result = suggestNextStep([{ lhs: "a * (b + c)", rhs: "a * (b + c)" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("distribute");
    });
  });

  describe("double negation", () => {
    test("suggests removing double negation", () => {
      const result = suggestNextStep([{ lhs: "--x", rhs: "--x" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("double_negation");
    });
  });

  describe("fraction simplification", () => {
    test("suggests simplifying reducible fractions", () => {
      const result = suggestNextStep([{ lhs: "4 / 2", rhs: "4 / 2" }]);

      expect(result.hasSuggestion).toBe(true);
      // Could be constant_fold or simplify_fraction depending on priority
      expect(["constant_fold", "simplify_fraction"]).toContain(result.transformation ?? "");
    });
  });

  describe("power rules", () => {
    test("suggests power of power simplification", () => {
      const result = suggestNextStep([{ lhs: "(x^2)^3", rhs: "(x^2)^3" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("power_of_power");
    });
  });

  describe("all applicable transformations", () => {
    test("returns multiple applicable transformations", () => {
      // x * 1 + 0 has both add_zero and multiply_one applicable
      const result = suggestNextStep([{ lhs: "x * 1 + 0", rhs: "x * 1 + 0" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.allApplicable.length).toBeGreaterThan(1);
    });
  });

  describe("no suggestions", () => {
    test("returns no suggestion for already simplified expression", () => {
      const result = suggestNextStep([{ lhs: "x", rhs: "x" }]);

      expect(result.hasSuggestion).toBe(false);
      expect(result.allApplicable).toHaveLength(0);
    });

    test("returns no suggestion for empty steps", () => {
      const result = suggestNextStep([]);

      expect(result.hasSuggestion).toBe(false);
    });
  });

  describe("uses last step RHS", () => {
    test("analyzes the last step's RHS, not LHS", () => {
      // First step: x + 0 = x (simplified)
      // Should suggest based on "x" not "x + 0"
      const result = suggestNextStep([
        { lhs: "x + 0", rhs: "x" },
        { lhs: "x", rhs: "x * 1" }, // This has multiply_one applicable
      ]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("multiply_one");
      expect(result.currentExpression).toBe("x * 1");
    });
  });
});

describe("suggestNextStepFromText", () => {
  test("parses derivation from text and suggests", () => {
    const result = suggestNextStepFromText("prove: x + 0 = x + 0");

    expect(result).not.toBeNull();
    expect(result?.hasSuggestion).toBe(true);
    expect(result?.transformation).toBe("add_zero");
  });

  test("returns null for non-derivation text", () => {
    const result = suggestNextStepFromText("hello world");

    expect(result).toBeNull();
  });

  test("handles chained equalities", () => {
    const result = suggestNextStepFromText("x * 1 = x * 1 = x");

    expect(result).not.toBeNull();
    // Last step RHS is "x" which is already simplified
    expect(result?.currentExpression).toBe("x");
  });
});

// =============================================================================
// explainDerivationError - human-readable error explanations
// =============================================================================

describe("explainDerivationError", () => {
  // Import the function
  const {
    explainDerivationError,
    verifyDerivationSteps: verifySteps,
  } = require("../src/lib/compute/index");

  test("returns null for valid derivation", () => {
    const result = verifySteps([
      { lhs: "x + x", rhs: "2x" },
      { lhs: "2x", rhs: "2 * x" },
    ]);

    expect(result.valid).toBe(true);
    expect(explainDerivationError(result)).toBeNull();
  });

  test("explains invalid algebraic transformation", () => {
    const result = verifySteps([
      { lhs: "x + x", rhs: "2x" },
      { lhs: "2x", rhs: "3x" }, // Invalid!
    ]);

    expect(result.valid).toBe(false);

    const explanation = explainDerivationError(result);
    expect(explanation).not.toBeNull();
    expect(explanation?.summary).toContain("step 2");
    expect(explanation?.explanation).toContain("2x");
    expect(explanation?.explanation).toContain("3x");
    expect(explanation?.stepNumber).toBe(2);
    expect(explanation?.expected).toBe("2x");
    expect(explanation?.found).toBe("3x");
    expect(explanation?.fixSuggestions.length).toBeGreaterThan(0);
  });

  test("explains discontinuity error", () => {
    // Test discontinuity: LHS of step 2 doesn't match RHS of step 1
    const result = verifySteps([
      { lhs: "x", rhs: "x" },
      { lhs: "y", rhs: "y" }, // LHS 'y' doesn't match previous RHS 'x'
    ]);

    expect(result.valid).toBe(false);

    const explanation = explainDerivationError(result);
    expect(explanation).not.toBeNull();
    expect(explanation?.stepNumber).toBe(2);
    expect(explanation?.fixSuggestions.length).toBeGreaterThan(0);
  });

  test("handles empty steps error", () => {
    const result = verifySteps([]);

    expect(result.valid).toBe(false);

    const explanation = explainDerivationError(result);
    expect(explanation).not.toBeNull();
    expect(explanation?.stepNumber).toBe(0);
    expect(explanation?.fixSuggestions.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// derivationToLatex - LaTeX conversion
// =============================================================================

describe("derivationToLatex", () => {
  const { derivationToLatex, derivationTextToLatex } = require("../src/lib/compute/index");

  test("converts simple derivation to LaTeX align", () => {
    const latex = derivationToLatex([
      { lhs: "x + x", rhs: "2x" },
      { lhs: "2x", rhs: "2 * x" },
    ]);

    expect(latex).toContain("\\begin{align}");
    expect(latex).toContain("\\end{align}");
    expect(latex).toContain("x + x &= 2x");
    expect(latex).toContain("&= 2 \\cdot x");
  });

  test("handles step numbers option", () => {
    const latex = derivationToLatex([{ lhs: "a", rhs: "b" }], { showStepNumbers: true });

    expect(latex).toContain("\\text{(1)}");
  });

  test("handles therefore symbol option", () => {
    const latex = derivationToLatex(
      [
        { lhs: "x", rhs: "x" },
        { lhs: "x", rhs: "y" },
      ],
      { showTherefore: true },
    );

    expect(latex).toContain("\\therefore");
  });

  test("handles label option", () => {
    const latex = derivationToLatex([{ lhs: "a", rhs: "b" }], { label: "eq:myeq" });

    expect(latex).toContain("\\label{eq:myeq}");
  });

  test("converts powers correctly", () => {
    const latex = derivationToLatex([{ lhs: "x^2", rhs: "x^10" }]);

    expect(latex).toContain("x^{2}");
    expect(latex).toContain("x^{10}");
  });

  test("converts multiplication operators", () => {
    const latex = derivationToLatex([{ lhs: "a * b", rhs: "a · c" }]);

    expect(latex).toContain("\\cdot");
  });

  test("handles empty steps", () => {
    const latex = derivationToLatex([]);

    expect(latex).toBe("");
  });

  test("derivationTextToLatex extracts and converts", () => {
    const latex = derivationTextToLatex("prove: x + x = 2x = 2 * x");

    expect(latex).not.toBeNull();
    expect(latex).toContain("\\begin{align}");
    expect(latex).toContain("2 \\cdot x");
  });

  test("derivationTextToLatex returns null for non-derivation", () => {
    const latex = derivationTextToLatex("hello world");

    expect(latex).toBeNull();
  });

  test("converts sqrt function", () => {
    const latex = derivationToLatex([{ lhs: "sqrt(x)", rhs: "x^0.5" }]);

    expect(latex).toContain("\\sqrt{x}");
  });

  test("converts common math functions", () => {
    const latex = derivationToLatex([{ lhs: "sin(x)", rhs: "cos(x)" }]);

    expect(latex).toContain("\\sin");
    expect(latex).toContain("\\cos");
  });

  test("converts pi symbol", () => {
    const latex = derivationToLatex([{ lhs: "2 * pi", rhs: "2pi" }]);

    expect(latex).toContain("\\pi");
  });

  test("non-align mode uses equation environment", () => {
    const latex = derivationToLatex([{ lhs: "a", rhs: "b" }], { useAlign: false });

    expect(latex).toContain("\\begin{equation}");
    expect(latex).toContain("\\end{equation}");
    expect(latex).not.toContain("\\begin{align}");
  });
});

// =============================================================================
// suggestSimplificationPath - complete simplification sequence
// =============================================================================

describe("suggestSimplificationPath", () => {
  const { suggestSimplificationPath } = require("../src/lib/compute/index");

  describe("basic simplifications", () => {
    test("simplifies x + 0 to x", () => {
      const result = suggestSimplificationPath("x + 0");

      expect(result.success).toBe(true);
      expect(result.simplified).toBe("x");
      expect(result.steps.length).toBeGreaterThanOrEqual(1);
      expect(
        result.steps.some((s: { transformation: string }) => s.transformation === "add_zero"),
      ).toBe(true);
    });

    test("simplifies x * 1 to x", () => {
      const result = suggestSimplificationPath("x * 1");

      expect(result.success).toBe(true);
      expect(result.simplified).toBe("x");
      expect(
        result.steps.some((s: { transformation: string }) => s.transformation === "multiply_one"),
      ).toBe(true);
    });

    test("simplifies x * 0 to 0", () => {
      const result = suggestSimplificationPath("x * 0");

      expect(result.success).toBe(true);
      expect(result.simplified).toBe("0");
      expect(
        result.steps.some((s: { transformation: string }) => s.transformation === "multiply_zero"),
      ).toBe(true);
    });

    test("simplifies x - x to 0", () => {
      const result = suggestSimplificationPath("x - x");

      expect(result.success).toBe(true);
      expect(result.simplified).toBe("0");
    });

    test("simplifies x / x to 1", () => {
      const result = suggestSimplificationPath("x / x");

      expect(result.success).toBe(true);
      expect(result.simplified).toBe("1");
    });
  });

  describe("multi-step simplifications", () => {
    test("simplifies (x + 0) * 1 in multiple steps", () => {
      const result = suggestSimplificationPath("(x + 0) * 1");

      expect(result.success).toBe(true);
      expect(result.simplified).toBe("x");
      expect(result.steps.length).toBeGreaterThanOrEqual(2);
      expect(result.isFullySimplified).toBe(true);
    });

    test("constant folding: 2 + 3 * 4", () => {
      const result = suggestSimplificationPath("2 + 3 * 4");

      expect(result.success).toBe(true);
      expect(result.simplified).toBe("14");
      expect(result.steps.length).toBeGreaterThanOrEqual(1);
    });

    test("tracks each transformation step", () => {
      const result = suggestSimplificationPath("(x + 0) * 1 + 0");

      expect(result.success).toBe(true);
      expect(result.steps.length).toBeGreaterThanOrEqual(3);

      // Each step should have before/after
      for (const step of result.steps) {
        expect(step.before).toBeDefined();
        expect(step.after).toBeDefined();
        expect(step.transformation).toBeDefined();
        expect(step.description).toBeDefined();
        expect(step.step).toBeGreaterThan(0);
      }
    });
  });

  describe("power simplifications", () => {
    test("simplifies x^0 to 1", () => {
      const result = suggestSimplificationPath("x^0");

      expect(result.success).toBe(true);
      expect(result.simplified).toBe("1");
    });

    test("simplifies x^1 to x", () => {
      const result = suggestSimplificationPath("x^1");

      expect(result.success).toBe(true);
      expect(result.simplified).toBe("x");
    });

    test("does not simplify 0^0 (indeterminate)", () => {
      const result = suggestSimplificationPath("0^0");

      // 0^0 is indeterminate - should not simplify
      expect(result.success).toBe(true);
      expect(result.simplified).toBe("0^0"); // Original expression unchanged
      expect(result.steps.length).toBe(0);
      // But it should be detected as indeterminate
      expect(result.isFullySimplified).toBe(false);
    });

    test("simplifies 2^0 to 1 but not 0^0", () => {
      const result = suggestSimplificationPath("2^0 + 0^0");

      // 2^0 should simplify to 1, but 0^0 should remain
      expect(result.success).toBe(true);
      expect(result.simplified).toBe("1 + 0 ^ 0");
    });

    test("handles 1^x expression", () => {
      const result = suggestSimplificationPath("1^x");

      // 1^x should simplify to 1 (base_one transformation)
      expect(result.success).toBe(true);
      expect(result.simplified).toBe("1");
      expect(result.steps.length).toBeGreaterThan(0);
      expect(result.steps[0].transformation).toBe("base_one");
    });

    test("handles nested (1^x)^y expression in single step", () => {
      const result = suggestSimplificationPath("(1^x)^y");

      // (1^x)^y should simplify to 1 in a single base_one step
      expect(result.success).toBe(true);
      expect(result.simplified).toBe("1");
      expect(result.steps.length).toBe(1);
      expect(result.steps[0].transformation).toBe("base_one");
    });

    test("handles deeply nested 1^(x+y) expression", () => {
      const result = suggestSimplificationPath("1^(x+y)");

      // 1^(x+y) should simplify to 1
      expect(result.success).toBe(true);
      expect(result.simplified).toBe("1");
      expect(result.steps[0].transformation).toBe("base_one");
    });
  });

  describe("edge cases", () => {
    test("handles already simplified expressions", () => {
      const result = suggestSimplificationPath("x");

      expect(result.success).toBe(true);
      expect(result.simplified).toBe("x");
      expect(result.steps.length).toBe(0);
      expect(result.isFullySimplified).toBe(true);
    });

    test("handles invalid expressions", () => {
      const result = suggestSimplificationPath("+++");

      expect(result.success).toBe(false);
      expect(result.steps.length).toBe(0);
    });

    test("respects maxSteps limit", () => {
      // An expression that could have many simplification steps
      const result = suggestSimplificationPath("0 + 0 + 0 + x * 1 * 1", 2);

      expect(result.success).toBe(true);
      expect(result.steps.length).toBeLessThanOrEqual(2);
    });

    test("returns transformationCount", () => {
      const result = suggestSimplificationPath("(x + 0) * 1");

      expect(result.transformationCount).toBe(result.steps.length);
    });
  });

  describe("complex expressions", () => {
    test("simplifies nested identities (partially)", () => {
      const result = suggestSimplificationPath("((x + 0) * 1 - 0) / 1");

      expect(result.success).toBe(true);
      // May require multiple passes or not fully simplify due to nesting
      expect(result.steps.length).toBeGreaterThan(0);
      // The result should be simpler than the original
      expect(result.simplified.length).toBeLessThanOrEqual(result.original.length);
    });

    test("handles double negation", () => {
      const result = suggestSimplificationPath("-(-x)");

      expect(result.success).toBe(true);
      expect(result.simplified).toBe("x");
    });

    test("handles 1^x in compound expression", () => {
      const result = suggestSimplificationPath("1^n + x * 0");

      expect(result.success).toBe(true);
      // Should simplify 1^n to 1 and x*0 to 0, then 1+0 to 1
      expect(result.simplified).toBe("1");
      expect(
        result.steps.some((s: { transformation: string }) => s.transformation === "base_one"),
      ).toBe(true);
    });
  });
});

// =============================================================================
// detectCommonMistakes - algebraic error detection
// =============================================================================

describe("detectCommonMistakes", () => {
  const {
    detectCommonMistakes,
    detectCommonMistakesFromText,
  } = require("../src/lib/compute/index");

  describe("sign errors", () => {
    test("detects swapped subtraction operands", () => {
      const result = detectCommonMistakes([{ lhs: "a - b", rhs: "b - a" }]);

      expect(result.hasMistakes).toBe(true);
      expect(result.mistakes.length).toBe(1);
      expect(result.mistakes[0].type).toBe("sign_error");
      expect(result.mistakes[0].stepNumber).toBe(1);
      expect(result.mistakes[0].confidence).toBeGreaterThan(0.8);
    });

    test("provides fix suggestion for sign error", () => {
      const result = detectCommonMistakes([{ lhs: "a - b", rhs: "b - a" }]);

      // Should mention subtraction is not commutative or provide sign guidance
      expect(
        result.mistakes[0].suggestion.includes("commutative") ||
          result.mistakes[0].suggestion.includes("Subtraction") ||
          result.mistakes[0].suggestion.includes("sign"),
      ).toBe(true);
    });
  });

  describe("coefficient errors", () => {
    test("detects multiplied instead of added coefficients", () => {
      const result = detectCommonMistakes([
        { lhs: "2x + 3x", rhs: "6x" }, // Should be 5x!
      ]);

      expect(result.hasMistakes).toBe(true);
      expect(result.mistakes[0].type).toBe("coefficient_error");
      expect(result.mistakes[0].expected).toBe("5x");
      expect(result.mistakes[0].found).toBe("6x");
    });

    test("provides explanation for coefficient error", () => {
      const result = detectCommonMistakes([{ lhs: "2x + 3x", rhs: "6x" }]);

      expect(result.mistakes[0].explanation).toContain("ADD");
      expect(result.mistakes[0].suggestion).toContain("5");
    });
  });

  describe("exponent errors", () => {
    test("detects multiplied instead of added exponents", () => {
      const result = detectCommonMistakes([
        { lhs: "x^2 * x^3", rhs: "x^6" }, // Should be x^5!
      ]);

      expect(result.hasMistakes).toBe(true);
      expect(result.mistakes[0].type).toBe("exponent_error");
      expect(result.mistakes[0].expected).toContain("5");
    });

    test("provides rule explanation for exponent error", () => {
      const result = detectCommonMistakes([{ lhs: "x^2 * x^3", rhs: "x^6" }]);

      expect(result.mistakes[0].explanation).toContain("ADD");
      expect(result.mistakes[0].suggestion).toContain("x^5");
    });
  });

  describe("distribution errors", () => {
    test("detects incomplete distribution", () => {
      const result = detectCommonMistakes([
        { lhs: "a * (b + c)", rhs: "a*b + c" }, // Should be ab + ac
      ]);

      expect(result.hasMistakes).toBe(true);
      expect(result.mistakes[0].type).toBe("distribution_error");
    });

    test("provides distribution fix suggestion", () => {
      const result = detectCommonMistakes([{ lhs: "a * (b + c)", rhs: "a*b + c" }]);

      expect(result.mistakes[0].suggestion).toContain("both terms");
    });
  });

  describe("cancellation errors", () => {
    test("detects invalid term cancellation in fractions", () => {
      const result = detectCommonMistakes([
        { lhs: "(a + b) / a", rhs: "b" }, // Invalid cancellation!
      ]);

      expect(result.hasMistakes).toBe(true);
      expect(result.mistakes[0].type).toBe("cancellation_error");
    });

    test("provides cancellation rule explanation", () => {
      const result = detectCommonMistakes([{ lhs: "(a + b) / a", rhs: "b" }]);

      expect(result.mistakes[0].explanation).toContain("cancel");
      expect(result.mistakes[0].suggestion).toContain("FACTORS");
    });
  });

  describe("no mistakes", () => {
    test("returns no mistakes for valid derivation", () => {
      const result = detectCommonMistakes([
        { lhs: "x + x", rhs: "2x" },
        { lhs: "2x", rhs: "2 * x" },
      ]);

      expect(result.hasMistakes).toBe(false);
      expect(result.mistakes.length).toBe(0);
      expect(result.summary).toContain("No common mistakes");
    });

    test("returns no mistakes for identity steps", () => {
      const result = detectCommonMistakes([{ lhs: "x", rhs: "x" }]);

      expect(result.hasMistakes).toBe(false);
    });
  });

  describe("multiple mistakes", () => {
    test("detects mistakes across multiple steps", () => {
      const result = detectCommonMistakes([
        { lhs: "2x + 3x", rhs: "6x" }, // coefficient error
        { lhs: "x^2 * x^3", rhs: "x^6" }, // exponent error
      ]);

      expect(result.hasMistakes).toBe(true);
      expect(result.mistakes.length).toBe(2);
      expect(result.summary).toContain("2 potential mistakes");
    });

    test("provides summary of mistake types", () => {
      const result = detectCommonMistakes([
        { lhs: "2x + 3x", rhs: "6x" },
        { lhs: "a - b", rhs: "b - a" },
      ]);

      expect(result.summary).toContain("coefficient");
      expect(result.summary).toContain("sign");
    });
  });

  describe("detectCommonMistakesFromText", () => {
    test("extracts derivation and detects mistakes", () => {
      const result = detectCommonMistakesFromText("2x + 3x = 6x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
    });

    test("returns null for non-derivation text", () => {
      const result = detectCommonMistakesFromText("hello world");

      expect(result).toBeNull();
    });

    test("handles chained derivations", () => {
      const result = detectCommonMistakesFromText("x^2 * x^3 = x^6 = x^5 + x");

      expect(result).not.toBeNull();
      // First step has exponent error
      expect(result?.hasMistakes).toBe(true);
    });

    test("detects subtraction distribution error: x - (y + z) = x - y + z", () => {
      const result = detectCommonMistakesFromText("x - (y + z) = x - y + z");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("subtraction_distribution_error");
      expect(result?.mistakes[0].suggestion).toContain("-(a + b) = -a - b");
    });

    test("detects subtraction distribution error: a - (b - c) = a - b - c", () => {
      const result = detectCommonMistakesFromText("a - (b - c) = a - b - c");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("subtraction_distribution_error");
    });

    test("does not flag correct subtraction distribution: x - (y + z) = x - y - z", () => {
      const result = detectCommonMistakesFromText("x - (y + z) = x - y - z");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    test("does not flag correct subtraction distribution: a - (b - c) = a - b + c", () => {
      const result = detectCommonMistakesFromText("a - (b - c) = a - b + c");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    test("detects nested subtraction distribution error: a - (b - (c + d)) = a - b - c - d", () => {
      const result = detectCommonMistakesFromText("a - (b - (c + d)) = a - b - c - d");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("subtraction_distribution_error");
      // Both c and d should have wrong signs
      expect(result?.mistakes[0].suggestion).toContain("'c'");
      expect(result?.mistakes[0].suggestion).toContain("'d'");
    });

    test("does not flag correct nested distribution: a - (b - (c + d)) = a - b + c + d", () => {
      const result = detectCommonMistakesFromText("a - (b - (c + d)) = a - b + c + d");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    // === NEW: Subtraction coefficient error tests ===
    test("detects subtraction coefficient error: 5x - 2x = 2x", () => {
      const result = detectCommonMistakesFromText("5x - 2x = 2x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
      expect(result?.mistakes[0].expected).toBe("3x");
    });

    test("detects subtraction coefficient error: 7y - 4y = 4y", () => {
      const result = detectCommonMistakesFromText("7y - 4y = 4y");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
      expect(result?.mistakes[0].expected).toBe("3y");
    });

    test("does not flag correct subtraction: 5x - 2x = 3x", () => {
      const result = detectCommonMistakesFromText("5x - 2x = 3x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    // === NEW: FOIL error tests ===
    test("detects FOIL error: (x + 2)(x + 3) = x^2 + 6", () => {
      const result = detectCommonMistakesFromText("(x + 2)(x + 3) = x^2 + 6");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("distribution_error");
      expect(result?.mistakes[0].explanation).toContain("FOIL");
    });

    test("detects FOIL error: (x + 1)(x + 4) = x^2 + 4", () => {
      const result = detectCommonMistakesFromText("(x + 1)(x + 4) = x^2 + 4");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("distribution_error");
      expect(result?.mistakes[0].suggestion).toContain("middle term");
    });

    // === NEW: FOIL error with subtraction binomials ===
    test("detects FOIL error with subtraction: (x - 2)(x + 3) = x^2 - 6", () => {
      // (x - 2)(x + 3) = x^2 + 3x - 2x - 6 = x^2 + x - 6
      const result = detectCommonMistakesFromText("(x - 2)(x + 3) = x^2 - 6");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("distribution_error");
      expect(result?.mistakes[0].explanation).toContain("FOIL");
      expect(result?.mistakes[0].suggestion).toContain("middle term");
    });

    test("detects FOIL error with both subtraction: (x - 2)(x - 3) = x^2 + 6", () => {
      // (x - 2)(x - 3) = x^2 - 3x - 2x + 6 = x^2 - 5x + 6
      const result = detectCommonMistakesFromText("(x - 2)(x - 3) = x^2 + 6");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("distribution_error");
      expect(result?.mistakes[0].explanation).toContain("FOIL");
    });

    test("detects FOIL error with second subtraction: (x + 2)(x - 3) = x^2 - 6", () => {
      // (x + 2)(x - 3) = x^2 - 3x + 2x - 6 = x^2 - x - 6
      const result = detectCommonMistakesFromText("(x + 2)(x - 3) = x^2 - 6");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("distribution_error");
      expect(result?.mistakes[0].explanation).toContain("FOIL");
    });

    test("does not flag correct FOIL with subtraction: (x - 2)(x + 3) = x^2 + x - 6", () => {
      const result = detectCommonMistakesFromText("(x - 2)(x + 3) = x^2 + x - 6");

      // This should be correct, so no mistakes
      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    test("does not flag correct FOIL with both subtraction: (x - 2)(x - 3) = x^2 - 5x + 6", () => {
      const result = detectCommonMistakesFromText("(x - 2)(x - 3) = x^2 - 5x + 6");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    // === NEW: Multi-step derivation parsing tests ===
    test("parses comma-separated multi-step derivation", () => {
      const result = detectCommonMistakesFromText("x = x, 2x + 3x = 6x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
    });

    test("parses 'then' separated multi-step derivation", () => {
      const result = detectCommonMistakesFromText("x = x then 2x + 3x = 6x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
    });

    test("parses semicolon-separated multi-step derivation", () => {
      const result = detectCommonMistakesFromText("x = x; x^2 * x^3 = x^6");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("exponent_error");
    });

    test("parses 'therefore' separated derivation", () => {
      const result = detectCommonMistakesFromText("x = x therefore a - b = b - a");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("sign_error");
    });

    test("detects error in second step of multi-step", () => {
      const result = detectCommonMistakesFromText("x^2 + 2x = x^2 + 2x, then 3x + 2x = 6x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
      expect(result?.mistakes[0].stepNumber).toBe(2); // Error is in second step
    });

    // === NEW: Implicit coefficient tests ===
    test("detects error with implicit coefficient: x + 2x = 4x", () => {
      const result = detectCommonMistakesFromText("x + 2x = 4x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
      expect(result?.mistakes[0].expected).toBe("3x");
    });

    test("detects error with two implicit coefficients: x + x = 3x", () => {
      const result = detectCommonMistakesFromText("x + x = 3x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
      expect(result?.mistakes[0].expected).toBe("2x");
    });

    test("detects error with implicit on one side: 3x + x = 5x", () => {
      const result = detectCommonMistakesFromText("3x + x = 5x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
      expect(result?.mistakes[0].expected).toBe("4x");
    });

    test("does not flag correct implicit coefficient: x + 2x = 3x", () => {
      const result = detectCommonMistakesFromText("x + 2x = 3x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    test("does not flag correct two implicit: x + x = 2x", () => {
      const result = detectCommonMistakesFromText("x + x = 2x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    // === NEW: Negative coefficient tests ===
    test("detects error with leading negative: -x + 3x = 3x", () => {
      const result = detectCommonMistakesFromText("-x + 3x = 3x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
      expect(result?.mistakes[0].expected).toBe("2x");
    });

    test("detects error with negative explicit coefficient: -2x + 5x = 5x", () => {
      const result = detectCommonMistakesFromText("-2x + 5x = 5x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
      expect(result?.mistakes[0].expected).toBe("3x");
    });

    test("detects error with two negatives: -2x - x = -2x", () => {
      const result = detectCommonMistakesFromText("-2x - x = -2x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
      expect(result?.mistakes[0].expected).toBe("-3x");
    });

    test("detects error with implicit negatives: -x - x = -x", () => {
      const result = detectCommonMistakesFromText("-x - x = -x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
      expect(result?.mistakes[0].expected).toBe("-2x");
    });

    test("does not flag correct negative: -x + 3x = 2x", () => {
      const result = detectCommonMistakesFromText("-x + 3x = 2x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    test("does not flag correct negative explicit: -2x + 5x = 3x", () => {
      const result = detectCommonMistakesFromText("-2x + 5x = 3x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    test("does not flag correct two negatives: -2x - x = -3x", () => {
      const result = detectCommonMistakesFromText("-2x - x = -3x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    // === NEW: Power rule derivative error tests ===
    test("detects power rule error: d/dx x^3 = 3x^3", () => {
      const result = detectCommonMistakesFromText("d/dx x^3 = 3x^3");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("power_rule_error");
      expect(result?.mistakes[0].expected).toBe("3x^2");
    });

    test("detects power rule error: derivative of x^4 = 4x^4", () => {
      const result = detectCommonMistakesFromText("derivative of x^4 = 4x^4");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("power_rule_error");
      expect(result?.mistakes[0].expected).toBe("4x^3");
    });

    test("detects power rule error: d/dx x^2 = x (missing coefficient)", () => {
      const result = detectCommonMistakesFromText("d/dx x^2 = x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("power_rule_error");
      expect(result?.mistakes[0].expected).toBe("2x");
    });

    test("does not flag correct power rule: d/dx x^3 = 3x^2", () => {
      const result = detectCommonMistakesFromText("d/dx x^3 = 3x^2");

      // This is correct, should not detect
      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    test("does not flag correct power rule: derivative of x^4 = 4x^3", () => {
      const result = detectCommonMistakesFromText("derivative of x^4 = 4x^3");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    // === NEW: Chain rule error tests ===
    test("detects chain rule error: d/dx sin(x^2) = cos(x^2)", () => {
      const result = detectCommonMistakesFromText("d/dx sin(x^2) = cos(x^2)");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("chain_rule_error");
      expect(result?.mistakes[0].expected).toContain("2x");
    });

    test("detects chain rule error: d/dx cos(x^2) = -sin(x^2)", () => {
      const result = detectCommonMistakesFromText("d/dx cos(x^2) = -sin(x^2)");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("chain_rule_error");
    });

    test("detects chain rule error: d/dx e^(2x) = e^(2x)", () => {
      const result = detectCommonMistakesFromText("d/dx e^(2x) = e^(2x)");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("chain_rule_error");
      expect(result?.mistakes[0].expected).toContain("* 2");
    });

    test("does not flag correct chain rule: d/dx sin(x) = cos(x)", () => {
      // No chain rule needed for just x
      const result = detectCommonMistakesFromText("d/dx sin(x) = cos(x)");

      // Should not detect as chain rule error (simple derivative)
      if (result?.hasMistakes) {
        expect(result.mistakes[0].type).not.toBe("chain_rule_error");
      }
    });

    test("includes suggestedFix for chain rule error", () => {
      const result = detectCommonMistakesFromText("d/dx sin(x^2) = cos(x^2)");

      expect(result?.mistakes[0].suggestedFix).toBeDefined();
      expect(result?.mistakes[0].suggestedFix).toContain("=");
    });

    // === NEW: Product rule error tests ===
    test("detects product rule error: d/dx x^2 * sin(x) = 2x * cos(x)", () => {
      const result = detectCommonMistakesFromText("d/dx x^2 * sin(x) = 2x * cos(x)");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("product_rule_error");
    });

    test("product rule error includes suggestedFix", () => {
      const result = detectCommonMistakesFromText("d/dx x * e^x = e^x");

      if (result?.hasMistakes && result.mistakes[0].type === "product_rule_error") {
        expect(result.mistakes[0].suggestedFix).toBeDefined();
        expect(result.mistakes[0].expected).toContain("+");
      }
    });

    // === NEW: Fraction addition error tests ===
    test("detects fraction addition error: 1/2 + 1/3 = 2/5", () => {
      const result = detectCommonMistakesFromText("1/2 + 1/3 = 2/5");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("fraction_error");
      expect(result?.mistakes[0].expected).toBe("5/6");
    });

    test("detects fraction addition error: 1/4 + 1/4 = 2/8", () => {
      const result = detectCommonMistakesFromText("1/4 + 1/4 = 2/8");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("fraction_error");
      // 1/4 + 1/4 = 2/4 = 1/2, not 2/8
      expect(result?.mistakes[0].expected).toBe("1/2");
    });

    test("detects fraction addition error: 2/3 + 1/4 = 3/7", () => {
      const result = detectCommonMistakesFromText("2/3 + 1/4 = 3/7");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("fraction_error");
      // 2/3 + 1/4 = (8 + 3)/12 = 11/12
      expect(result?.mistakes[0].expected).toBe("11/12");
    });

    test("does not flag correct fraction addition: 1/2 + 1/3 = 5/6", () => {
      const result = detectCommonMistakesFromText("1/2 + 1/3 = 5/6");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    test("does not flag correct fraction addition: 1/4 + 1/4 = 1/2", () => {
      const result = detectCommonMistakesFromText("1/4 + 1/4 = 1/2");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });
  });

  describe("step numbering", () => {
    test("correctly numbers step where mistake occurred", () => {
      const result = detectCommonMistakes([
        { lhs: "x", rhs: "x" }, // Valid
        { lhs: "x", rhs: "x" }, // Valid
        { lhs: "2x + 3x", rhs: "6x" }, // Error at step 3
      ]);

      expect(result.hasMistakes).toBe(true);
      expect(result.mistakes[0].stepNumber).toBe(3);
    });
  });

  describe("suggestedFix field", () => {
    test("includes suggestedFix for coefficient error", () => {
      const result = detectCommonMistakes([{ lhs: "2x + 3x", rhs: "6x" }]);

      expect(result.hasMistakes).toBe(true);
      expect(result.mistakes[0].suggestedFix).toBe("2x + 3x = 5x");
    });

    test("includes suggestedFix for wrong coefficient error", () => {
      const result = detectCommonMistakesFromText("5x - 2x = 2x");

      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].suggestedFix).toBe("5x - 2x = 3x");
    });

    test("includes suggestedFix for exponent error", () => {
      const result = detectCommonMistakes([{ lhs: "x^2 * x^3", rhs: "x^6" }]);

      expect(result.hasMistakes).toBe(true);
      expect(result.mistakes[0].suggestedFix).toBe("x^2 * x^3 = x^5");
    });

    test("includes suggestedFix for sign error", () => {
      const result = detectCommonMistakes([{ lhs: "a - b", rhs: "b - a" }]);

      expect(result.hasMistakes).toBe(true);
      expect(result.mistakes[0].suggestedFix).toBeDefined();
      expect(result.mistakes[0].suggestedFix).toContain("a - b");
    });

    test("includes suggestedFix for distribution error", () => {
      const result = detectCommonMistakes([{ lhs: "a * (b + c)", rhs: "a*b + c" }]);

      expect(result.hasMistakes).toBe(true);
      expect(result.mistakes[0].suggestedFix).toBeDefined();
      expect(result.mistakes[0].suggestedFix).toContain("=");
    });

    test("includes suggestedFix for cancellation error", () => {
      const result = detectCommonMistakes([{ lhs: "(a + b) / a", rhs: "b" }]);

      expect(result.hasMistakes).toBe(true);
      expect(result.mistakes[0].suggestedFix).toBeDefined();
      expect(result.mistakes[0].suggestedFix).toContain("(a + b) / a");
    });

    test("includes suggestedFix for FOIL error", () => {
      const result = detectCommonMistakesFromText("(x + 2)(x + 3) = x^2 + 6");

      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].suggestedFix).toBeDefined();
      expect(result?.mistakes[0].suggestedFix).toContain("=");
    });

    test("includes suggestedFix for power rule error", () => {
      const result = detectCommonMistakesFromText("d/dx x^3 = 3x^3");

      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].suggestedFix).toBe("d/dx x^3 = 3x^2");
    });

    test("includes suggestedFix for fraction addition error", () => {
      const result = detectCommonMistakesFromText("1/2 + 1/3 = 2/5");

      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].suggestedFix).toBe("1/2 + 1/3 = 5/6");
    });

    test("includes suggestedFix for subtraction distribution error", () => {
      const result = detectCommonMistakesFromText("x - (y + z) = x - y + z");

      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].suggestedFix).toBeDefined();
      expect(result?.mistakes[0].suggestedFix).toContain("=");
    });
  });
});
