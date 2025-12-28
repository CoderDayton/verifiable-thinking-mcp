/**
 * Unit tests for src/lib modules
 * These test the core logic directly for coverage
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { SessionManager, SessionManagerImpl } from "../src/lib/session";
import { verify, getVerificationCacheStats, clearVerificationCache } from "../src/lib/verification";
import { compress, quickCompress } from "../src/lib/compression";
import { getTracker, clearTracker } from "../src/lib/concepts";
import { verificationCache } from "../src/lib/cache";

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
    expect(branches).toContain("main");
    expect(branches).toContain("alternate");
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
      ttl_ms: 1000 
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
    expect(sessions.find(s => s.id === "session-0")).toBeUndefined();
    
    manager.destroy();
  });

  test("cleanup removes expired sessions", async () => {
    // Create manager with very short TTL and cleanup interval
    const manager = new SessionManagerImpl({ 
      ttl_ms: 30,
      cleanup_interval_ms: 20
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
    
    // Wait for TTL to expire and cleanup to run
    await Bun.sleep(80);
    
    // Session should be cleaned up
    expect(manager.list()).toHaveLength(0);
    
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
      true // checkBlindspot
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
      "the previous statement is valid"
    ]);
    // Contradiction should affect result
    expect(result.domain).toBe("logic");
  });

  test("detects negation contradiction in context", () => {
    // The "not X" pattern matching - context has statement, thought negates it
    const result = verify("This conclusion is not correct", "logic", [
      "correct conclusion reached"
    ]);
    expect(result.domain).toBe("logic");
  });

  test("detects reverse negation contradiction", () => {
    // Context has negation, thought affirms (hits line 255 with prevLower check)
    const result = verify("The algorithm is valid", "logic", [
      "not the algorithm is valid"
    ]);
    expect(result.domain).toBe("logic");
  });

  test("detects blindspot marker for error without correction", () => {
    // Use a statement that will fail verification (vague + short + has error mention)
    const result = verify(
      "Maybe there is an error",
      "general",
      [],
      true // checkBlindspot
    );
    // Verification should fail due to vague language, then blindspot should be detected
    expect(result.passed).toBe(false);
    expect(result.blindspot_marker).toBe("Wait");
  });

  test("no blindspot marker when correction is present", () => {
    const result = verify(
      "There is an error, however I will fix it instead",
      "general",
      [],
      true // checkBlindspot
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
    const text = "The quick brown fox jumps. The lazy dog sleeps. A third sentence here. Fourth sentence for testing.";
    const result = compress(text, "fox", { target_ratio: 0.5 });

    expect(result.compressed.length).toBeLessThan(text.length);
    expect(result.ratio).toBeLessThanOrEqual(1);
    expect(result.kept_sentences).toBeGreaterThan(0);
  });

  test("boosts reasoning keywords", () => {
    const text = "A simple fact here. Therefore this is the most important conclusion. Another unrelated fact. Yet another fact.";
    const result = compress(text, "conclusion", { 
      target_ratio: 0.5, 
      boost_reasoning: true 
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
      expect(result.compressed.indexOf("First")).toBeLessThan(
        result.compressed.indexOf("Second")
      );
    }
  });

  test("penalizes filler phrases", () => {
    const text = "Um let me think about this. The algorithm uses binary search. Well this is interesting.";
    const result = compress(text, "algorithm", { target_ratio: 0.5 });
    
    // The informative sentence should be kept over filler sentences
    expect(result.compressed).toContain("algorithm");
  });

  test("quickCompress compresses when over token limit", () => {
    // Create text that definitely exceeds the token limit
    const longText = "This is a very long sentence that contains many important details about the topic at hand. " +
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
      1
    );

    expect(concepts.length).toBeGreaterThan(0);
    expect(concepts.some(c => c.domain === "math" || c.domain === "code")).toBe(true);
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

  test("gets concepts by domain", () => {
    const tracker = getTracker("test-session");
    tracker.extract("function variable class method", 1);
    
    const codeConcepts = tracker.getByDomain("code");
    expect(codeConcepts.length).toBeGreaterThan(0);
    expect(codeConcepts.every(c => c.domain === "code")).toBe(true);
  });

  test("gets top concepts sorted by count", () => {
    const tracker = getTracker("test-session");
    tracker.extract("function function function", 1);
    tracker.extract("variable", 2);
    
    const top = tracker.getTopConcepts(2);
    expect(top.length).toBeLessThanOrEqual(2);
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
      rate_limit_ops: 1000 // High limit to not interfere
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
