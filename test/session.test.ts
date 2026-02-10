/**
 * Unit tests for SessionManager
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { SessionManager, SessionManagerImpl } from "../src/session/manager";

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

  test("cleanup removes expired sessions async", async () => {
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
