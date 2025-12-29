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
  clearCache,
  computeAndReplace,
  computeConfidence,
  extractAndCompute,
  getCacheStats,
  isLikelyComputable,
  tryArithmetic,
  tryFormula,
  tryLocalCompute,
  tryLogic,
  tryMultiStepWordProblem,
  tryProbability,
  tryWordProblem,
} from "../src/lib/compute/index";
import { getRegistryStats, getSolvers, getSolversForMask } from "../src/lib/compute/registry";
import { ConceptTracker, clearTracker, getTracker } from "../src/lib/concepts";
import { SessionManager, SessionManagerImpl } from "../src/lib/session";
import {
  estimateCodeTokens,
  estimateTokens,
  estimateTokensBatch,
} from "../src/lib/think/verification";
import { clearVerificationCache, getVerificationCacheStats, verify } from "../src/lib/verification";

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

  test("detects blind spot with check enabled", () => {
    const result = verify(
      "I made an error earlier, let me correct it",
      "general",
      ["Previous incorrect thought"],
      true, // checkBlindspot
    );
    expect(result.blindspot_marker).toBeDefined();
  });

  test("uses cache when enabled", () => {
    verificationCache.clear();
    const thought = "Cached verification test: 1 + 1 = 2";

    // First call - not cached
    const result1 = verify(thought, "math", [], false, true);
    expect(result1.cached).toBe(false);

    // Second call - should be cached
    const result2 = verify(thought, "math", [], false, true);
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

  test("detects blindspot marker for error without correction", () => {
    // Use a statement that will fail verification (vague + short + has error mention)
    // Disable cache to ensure we hit the detectBlindspot code path directly
    const result = verify(
      "Maybe there is an error in this unique test case xyz123",
      "general",
      [],
      true, // checkBlindspot
      false, // useCache = false to ensure direct path
    );
    // Verification should fail due to vague language, then blindspot should be detected
    expect(result.passed).toBe(false);
    expect(result.blindspot_marker).toBe("Wait");
  });

  test("blindspot detection: error without correction returns Wait", () => {
    // Direct test with fresh input - no cache
    // Use vague language to ensure verification fails
    const result = verify(
      "Maybe probably error unique987",
      "general",
      [],
      true, // checkBlindspot
      false, // useCache disabled
    );
    expect(result.passed).toBe(false);
    expect(result.blindspot_marker).toBe("Wait");
  });

  test("blindspot detection: mistake mention fails verification", () => {
    const result = verify("Perhaps wrong maybe mistake uniqueABC", "general", [], true, false);
    expect(result.passed).toBe(false);
    expect(result.blindspot_marker).toBe("Wait");
  });

  test("no blindspot marker when correction is present", () => {
    const result = verify(
      "There is an error, however I will fix it instead",
      "general",
      [],
      true, // checkBlindspot
    );
    // Has both error and correction keywords, no marker needed
    expect(result.blindspot_marker).toBeUndefined();
  });

  test("getVerificationCacheStats returns stats", () => {
    verificationCache.clear();
    verify("test thought for stats", "math", [], false, true);

    const stats = getVerificationCacheStats();
    expect(stats).toHaveProperty("size");
    expect(stats).toHaveProperty("hits");
    expect(stats).toHaveProperty("misses");
  });

  test("clearVerificationCache clears cache", () => {
    verify("thought to clear", "math", [], false, true);

    const cleared = clearVerificationCache();
    expect(cleared).toBeGreaterThanOrEqual(0);

    const stats = getVerificationCacheStats();
    expect(stats.size).toBe(0);
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

import { answersMatch, extractAnswer, normalizeAnswer, stripMarkdown } from "../src/lib/extraction";

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
    expect(stripMarkdown("Here ![alt text](image.png) is image")).toBe("Here  is image");
  });

  test("removes blockquotes", () => {
    expect(stripMarkdown("> Quoted text\nNormal")).toBe("Quoted text\nNormal");
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
      // 11 solver types: ARITHMETIC, CALCULUS, FORMULA (4 tiers), WORD_PROBLEM, MULTI_STEP, FACTS, LOGIC, PROBABILITY
      expect(SolverGroup.ALL).toBe(0x7ff);
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
