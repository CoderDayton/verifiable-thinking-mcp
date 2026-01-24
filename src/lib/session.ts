/**
 * Session Manager - High-performance session state with O(1) lookups
 * Features:
 * - O(1) step lookup via stepIndex Map
 * - O(1) step existence check via stepNumbers Set
 * - O(1) step-to-branch lookup via stepToBranchMap
 * - Revision tracking with revised_by marker
 * - Branch depth limits
 * - Batched TTL cleanup for efficiency
 * - Token tracking sync on cleanup
 */

import { clearSessionTokens } from "./tokens.ts";

export interface ThoughtRecord {
  id: string;
  step_number: number;
  thought: string;
  timestamp: number;
  branch_id: string;
  verification?: {
    passed: boolean;
    confidence: number;
    domain: string;
  };
  concepts?: string[];
  compressed_context?: string;
  // Compression stats
  compression?: {
    input_bytes_saved: number;
    output_bytes_saved: number;
    context_bytes_saved: number;
    // Token tracking for LLM budget planning
    original_tokens?: number;
    compressed_tokens?: number;
  };
  // Revision tracking
  revises_step?: number;
  revision_reason?: string;
  revised_by?: number; // Step number that revised this step
  // Branching
  branch_from?: number;
  branch_name?: string;
  branch_depth?: number;
  // Dependencies
  dependencies?: number[];
  // Tool tracking
  tools_used?: string[];
  external_context?: Record<string, unknown>;
  // Hypothesis-driven branching
  hypothesis?: string;
  success_criteria?: string;
  // Preconditions (assumptions that must be true for this step)
  preconditions?: string[];
}

export interface Branch {
  id: string;
  name: string;
  from_step: number;
  depth: number;
  created_at: number;
  /** Falsifiable hypothesis this branch tests */
  hypothesis?: string;
  /** Criteria for proving/disproving the hypothesis */
  success_criteria?: string;
}

export interface Session {
  id: string;
  created_at: number;
  updated_at: number;
  thoughts: ThoughtRecord[];
  branches: Map<string, Branch>;
  metadata: Record<string, unknown>;
  // O(1) lookup indexes
  stepIndex: Map<number, ThoughtRecord>;
  stepNumbers: Set<number>;
  stepToBranchMap: Map<number, string>;
  toolsUsedSet: Set<string>;
  // Original question (for auto spot-check at complete)
  question?: string;
  // Pending thought that failed verification (awaiting recovery action)
  pendingThought?: {
    thought: ThoughtRecord;
    verificationError: {
      issue: string;
      evidence: string;
      suggestions: string[];
      confidence: number;
      domain: string;
    };
  };
}

interface SessionManagerConfig {
  ttl_ms: number;
  cleanup_interval_ms: number;
  max_sessions: number;
  max_branch_depth: number;
  max_history_size: number;
  cleanup_batch_size: number; // Steps between cleanup checks
}

const DEFAULT_CONFIG: SessionManagerConfig = {
  ttl_ms: 30 * 60 * 1000, // 30 minutes
  cleanup_interval_ms: 5 * 60 * 1000, // 5 minutes
  max_sessions: 100,
  max_branch_depth: 3,
  max_history_size: 100,
  cleanup_batch_size: 10, // Check cleanup every 10 steps
};

/** Max pooled sessions to keep for reuse (avoids GC pressure from Map/Set allocations) */
const MAX_POOL_SIZE = 20;

class SessionManagerImpl {
  private sessions: Map<string, Session> = new Map();
  private config: SessionManagerConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private stepsSinceCleanup = 0;
  /** Pool of recycled sessions to avoid allocation churn */
  private sessionPool: Session[] = [];
  /** Active session ID for single-session mode (server tracks instead of LLM) */
  private activeSessionId: string | null = null;

  constructor(config: Partial<SessionManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanup();
  }

  private startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanup_interval_ms);
  }

  /**
   * Recycle a session by clearing its data structures without deallocating.
   * This avoids GC pressure from repeatedly creating new Map/Set instances.
   */
  private recycleSession(session: Session): void {
    if (this.sessionPool.length >= MAX_POOL_SIZE) {
      // Pool full, let GC handle it
      return;
    }

    // Clear data structures without deallocating
    session.thoughts.length = 0;
    session.branches.clear();
    session.stepIndex.clear();
    session.stepNumbers.clear();
    session.stepToBranchMap.clear();
    session.toolsUsedSet.clear();
    session.metadata = {};
    session.question = undefined;
    session.pendingThought = undefined;

    this.sessionPool.push(session);
  }

  /**
   * Get a pooled session if available, otherwise create new.
   * Reusing sessions avoids Map/Set allocation overhead.
   */
  private getPooledSession(sessionId: string): Session {
    const pooled = this.sessionPool.pop();
    if (pooled) {
      // Reinitialize pooled session with new id
      pooled.id = sessionId;
      pooled.created_at = Date.now();
      pooled.updated_at = Date.now();
      pooled.branches.set("main", {
        id: "main",
        name: "Main",
        from_step: 0,
        depth: 0,
        created_at: Date.now(),
      });
      return pooled;
    }

    // No pooled session available, create new
    return this.createSession(sessionId);
  }

  private cleanup(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [id, session] of this.sessions) {
      if (now - session.updated_at > this.config.ttl_ms) {
        expired.push(id);
      }
    }

    for (const id of expired) {
      // Clear active session if it's expiring
      if (this.activeSessionId === id) {
        this.activeSessionId = null;
      }

      // Clear token tracking FIRST (before session deletion and recycling)
      clearSessionTokens(id);

      const session = this.sessions.get(id);
      // Delete from map BEFORE recycling to prevent use-after-free race
      this.sessions.delete(id);
      if (session) {
        this.recycleSession(session);
      }
    }
  }

  /** Batched cleanup - only runs every N steps */
  private batchedCleanup(force = false): void {
    this.stepsSinceCleanup++;
    if (!force && this.stepsSinceCleanup < this.config.cleanup_batch_size) {
      return;
    }
    this.stepsSinceCleanup = 0;
    this.cleanup();
  }

  private createSession(sessionId: string): Session {
    return {
      id: sessionId,
      created_at: Date.now(),
      updated_at: Date.now(),
      thoughts: [],
      branches: new Map([
        ["main", { id: "main", name: "Main", from_step: 0, depth: 0, created_at: Date.now() }],
      ]),
      metadata: {},
      stepIndex: new Map(),
      stepNumbers: new Set(),
      stepToBranchMap: new Map(),
      toolsUsedSet: new Set(),
    };
  }

  getOrCreate(sessionId: string): Session {
    let session = this.sessions.get(sessionId);

    if (!session) {
      // Enforce max sessions limit
      if (this.sessions.size >= this.config.max_sessions) {
        let oldest: [string, Session] | null = null;
        for (const entry of this.sessions) {
          if (!oldest || entry[1].updated_at < oldest[1].updated_at) {
            oldest = entry;
          }
        }
        if (oldest) {
          const oldSession = this.sessions.get(oldest[0]);
          if (oldSession) {
            this.recycleSession(oldSession);
          }
          this.sessions.delete(oldest[0]);
        }
      }

      session = this.getPooledSession(sessionId);
      this.sessions.set(sessionId, session);
    }

    return session;
  }

  get(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.updated_at = Date.now();
    }
    return session;
  }

  /** O(1) step lookup */
  getStep(sessionId: string, stepNumber: number): ThoughtRecord | undefined {
    const session = this.get(sessionId);
    return session?.stepIndex.get(stepNumber);
  }

  /** O(1) step existence check */
  hasStep(sessionId: string, stepNumber: number): boolean {
    const session = this.get(sessionId);
    return session?.stepNumbers.has(stepNumber) ?? false;
  }

  /** Calculate branch depth for a step */
  calculateBranchDepth(session: Session, fromStep: number): number {
    const branchId = session.stepToBranchMap.get(fromStep);
    if (branchId) {
      const branch = session.branches.get(branchId);
      return branch ? branch.depth + 1 : 1;
    }
    return 1; // Branching from main history
  }

  /** Add thought with O(1) index updates */
  addThought(sessionId: string, thought: ThoughtRecord): { success: boolean; error?: string } {
    const session = this.getOrCreate(sessionId);

    // Batched cleanup
    this.batchedCleanup();

    // Validate revision
    if (thought.revises_step !== undefined) {
      if (thought.revises_step >= thought.step_number) {
        return {
          success: false,
          error: `Cannot revise step ${thought.revises_step} from step ${thought.step_number}`,
        };
      }
      // Mark original step as revised
      const original = session.stepIndex.get(thought.revises_step);
      if (original) {
        original.revised_by = thought.step_number;
      }
    }

    // Handle branching
    if (thought.branch_from !== undefined) {
      if (thought.branch_from >= thought.step_number) {
        return { success: false, error: `Cannot branch from future step ${thought.branch_from}` };
      }
      if (!session.stepNumbers.has(thought.branch_from)) {
        return {
          success: false,
          error: `Cannot branch from non-existent step ${thought.branch_from}`,
        };
      }

      const depth = this.calculateBranchDepth(session, thought.branch_from);
      if (depth > this.config.max_branch_depth) {
        return {
          success: false,
          error: `Branch depth ${depth} exceeds max ${this.config.max_branch_depth}`,
        };
      }

      const branchId = thought.branch_id || `branch-${Date.now()}`;
      if (!session.branches.has(branchId)) {
        session.branches.set(branchId, {
          id: branchId,
          name: thought.branch_name || `Alternative ${session.branches.size}`,
          from_step: thought.branch_from,
          depth,
          created_at: Date.now(),
          hypothesis: thought.hypothesis,
          success_criteria: thought.success_criteria,
        });
      }
      thought.branch_id = branchId;
      thought.branch_depth = depth;
    }

    // Validate dependencies
    if (thought.dependencies?.length) {
      const missing = thought.dependencies.filter((d) => !session.stepNumbers.has(d));
      if (missing.length > 0) {
        // Warn but don't fail
        console.error(`Warning: Missing dependencies: steps ${missing.join(", ")}`);
      }
      // Check for circular/future dependencies
      const invalid = thought.dependencies.filter((d) => d >= thought.step_number);
      if (invalid.length > 0) {
        return { success: false, error: `Cannot depend on future steps: ${invalid.join(", ")}` };
      }
    }

    // Track tools used
    if (thought.tools_used?.length) {
      for (const tool of thought.tools_used) {
        session.toolsUsedSet.add(tool);
      }
    }

    // Add to history and update indexes
    session.thoughts.push(thought);
    session.stepIndex.set(thought.step_number, thought);
    session.stepNumbers.add(thought.step_number);

    const branchId = thought.branch_id || "main";
    session.stepToBranchMap.set(thought.step_number, branchId);

    // Ensure branch exists
    if (!session.branches.has(branchId)) {
      session.branches.set(branchId, {
        id: branchId,
        name: branchId === "main" ? "Main" : branchId,
        from_step: 0,
        depth: 0,
        created_at: Date.now(),
      });
    }

    session.updated_at = Date.now();

    // Trim history if needed
    this.trimHistory(session);

    return { success: true };
  }

  /** Trim history and clean up orphaned references */
  private trimHistory(session: Session): void {
    if (session.thoughts.length <= this.config.max_history_size) {
      return;
    }

    const toRemove = session.thoughts.length - this.config.max_history_size;
    const removed = session.thoughts.splice(0, toRemove);

    // Clean up indexes
    for (const thought of removed) {
      session.stepIndex.delete(thought.step_number);
      session.stepNumbers.delete(thought.step_number);
      session.stepToBranchMap.delete(thought.step_number);
    }

    // Clean up branches that reference removed steps
    const removedStepNumbers = new Set(removed.map((t) => t.step_number));
    for (const [branchId, branch] of session.branches) {
      if (removedStepNumbers.has(branch.from_step) && branchId !== "main") {
        session.branches.delete(branchId);
      }
    }
  }

  getThoughts(sessionId: string, branchId?: string): ThoughtRecord[] {
    const session = this.get(sessionId);
    if (!session) return [];

    if (branchId) {
      return session.thoughts.filter((t) => t.branch_id === branchId);
    }
    return session.thoughts;
  }

  getBranches(sessionId: string): Branch[] {
    const session = this.get(sessionId);
    return session ? Array.from(session.branches.values()) : [];
  }

  list(): { id: string; thought_count: number; branches: string[]; age_ms: number }[] {
    const now = Date.now();
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      thought_count: s.thoughts.length,
      branches: Array.from(s.branches.keys()),
      age_ms: now - s.created_at,
    }));
  }

  clear(sessionId: string): boolean {
    // Clear active session tracking if this is the active session
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }
    // Clear token tracking when session is explicitly cleared
    clearSessionTokens(sessionId);
    return this.sessions.delete(sessionId);
  }

  clearAll(): number {
    const count = this.sessions.size;
    // Clear token tracking for all sessions
    for (const id of this.sessions.keys()) {
      clearSessionTokens(id);
    }
    this.sessions.clear();
    // Also clear the active session tracking
    this.activeSessionId = null;
    return count;
  }

  getSummary(sessionId: string): string | null {
    const session = this.get(sessionId);
    if (!session) return null;

    // Aggregate compression stats
    let totalInputSaved = 0;
    let totalOutputSaved = 0;
    let totalContextSaved = 0;
    let compressedSteps = 0;

    for (const thought of session.thoughts) {
      if (thought.compression) {
        compressedSteps++;
        totalInputSaved += thought.compression.input_bytes_saved;
        totalOutputSaved += thought.compression.output_bytes_saved;
        totalContextSaved += thought.compression.context_bytes_saved;
      }
    }

    const totalBytesSaved = totalInputSaved + totalOutputSaved + totalContextSaved;

    const lines: string[] = [
      `Session: ${sessionId}`,
      `Thoughts: ${session.thoughts.length}`,
      `Branches: ${Array.from(session.branches.keys()).join(", ")}`,
      `Tools Used: ${Array.from(session.toolsUsedSet).join(", ") || "none"}`,
    ];

    // Add compression summary if any compression occurred
    if (compressedSteps > 0) {
      lines.push(
        `Compression: ${compressedSteps} steps, ${totalBytesSaved} bytes saved (input: ${totalInputSaved}, output: ${totalOutputSaved}, context: ${totalContextSaved})`,
      );
    }

    lines.push("");

    for (const thought of session.thoughts) {
      const v = thought.verification;
      const status = v ? (v.passed ? "+" : "x") : "?";
      const revised = thought.revised_by ? ` [revised by ${thought.revised_by}]` : "";
      const revising = thought.revises_step ? ` [revises ${thought.revises_step}]` : "";
      lines.push(
        `[${status}] Step ${thought.step_number} (${thought.branch_id})${revised}${revising}: ${thought.thought.slice(0, 60)}...`,
      );
    }

    return lines.join("\n");
  }

  getCompressed(sessionId: string): string | null {
    const session = this.get(sessionId);
    if (!session) return null;

    // Return only key thoughts (verified, final, or not revised)
    const key = session.thoughts.filter(
      (t) =>
        !t.revised_by && // Not superseded
        (t.verification?.passed ||
          t.step_number === Math.max(...session.thoughts.map((x) => x.step_number))),
    );

    return key.map((t) => t.thought).join(" -> ");
  }

  /** Get revision chain for a step */
  getRevisionChain(sessionId: string, stepNumber: number): ThoughtRecord[] {
    const session = this.get(sessionId);
    if (!session) return [];

    const chain: ThoughtRecord[] = [];
    let current = session.stepIndex.get(stepNumber);

    while (current) {
      chain.push(current);
      if (current.revised_by) {
        current = session.stepIndex.get(current.revised_by);
      } else {
        break;
      }
    }

    return chain;
  }

  /** Get compression stats for a session */
  getCompressionStats(sessionId: string): {
    totalBytesSaved: number;
    stepCount: number;
    breakdown: { input: number; output: number; context: number };
    tokens: { original: number; compressed: number; saved: number };
  } | null {
    const session = this.get(sessionId);
    if (!session) return null;

    let totalInput = 0;
    let totalOutput = 0;
    let totalContext = 0;
    let totalOriginalTokens = 0;
    let totalCompressedTokens = 0;
    let stepCount = 0;

    for (const thought of session.thoughts) {
      if (thought.compression) {
        stepCount++;
        totalInput += thought.compression.input_bytes_saved;
        totalOutput += thought.compression.output_bytes_saved;
        totalContext += thought.compression.context_bytes_saved;
        totalOriginalTokens += thought.compression.original_tokens || 0;
        totalCompressedTokens += thought.compression.compressed_tokens || 0;
      }
    }

    return {
      totalBytesSaved: totalInput + totalOutput + totalContext,
      stepCount,
      breakdown: { input: totalInput, output: totalOutput, context: totalContext },
      tokens: {
        original: totalOriginalTokens,
        compressed: totalCompressedTokens,
        saved: totalOriginalTokens - totalCompressedTokens,
      },
    };
  }

  /** Get path from root to a step (ancestors) - O(n) where n = path length */
  getPath(sessionId: string, stepNumber: number): ThoughtRecord[] {
    const session = this.get(sessionId);
    if (!session) return [];

    const path: ThoughtRecord[] = [];
    let current = session.stepIndex.get(stepNumber);

    while (current) {
      path.unshift(current); // Add to front to get root-first order

      // Walk back via branch_from or revision chain
      if (current.branch_from !== undefined) {
        current = session.stepIndex.get(current.branch_from);
      } else if (current.revises_step !== undefined) {
        // Skip to the original step being revised
        current = session.stepIndex.get(current.revises_step);
      } else if (current.step_number > 1) {
        // Linear predecessor in same branch
        const prevStep = current.step_number - 1;
        const prev = session.stepIndex.get(prevStep);
        // Only follow if same branch
        if (prev && prev.branch_id === current.branch_id) {
          current = prev;
        } else {
          break;
        }
      } else {
        break;
      }
    }

    return path;
  }

  /** Get current step number for a session/branch */
  getCurrentStep(sessionId: string, branchId = "main"): number {
    const session = this.get(sessionId);
    if (!session) return 0;

    const branchThoughts = session.thoughts.filter((t) => t.branch_id === branchId);
    if (branchThoughts.length === 0) return 0;

    return Math.max(...branchThoughts.map((t) => t.step_number));
  }

  /** Get next step number for a session/branch */
  getNextStep(sessionId: string, branchId = "main"): number {
    return this.getCurrentStep(sessionId, branchId) + 1;
  }

  /** Calculate average confidence across session */
  getAverageConfidence(sessionId: string, branchId?: string): number {
    const session = this.get(sessionId);
    if (!session) return 0;

    const thoughts = branchId
      ? session.thoughts.filter((t) => t.branch_id === branchId)
      : session.thoughts;

    if (thoughts.length === 0) return 0;

    const confidences = thoughts
      .filter((t) => t.verification?.confidence !== undefined)
      .map((t) => t.verification!.confidence);

    if (confidences.length === 0) return 0;

    return confidences.reduce((a, b) => a + b, 0) / confidences.length;
  }

  /** Get total token usage for a session (estimated from thought lengths) */
  getTokenUsage(sessionId: string): {
    total: number;
    compressed: number;
    uncompressed: number;
  } {
    const session = this.get(sessionId);
    if (!session) return { total: 0, compressed: 0, uncompressed: 0 };

    let compressed = 0;
    let uncompressed = 0;

    for (const thought of session.thoughts) {
      // Estimate tokens: ~4 chars per token
      const thoughtTokens = Math.ceil(thought.thought.length / 4);

      if (thought.compression?.compressed_tokens !== undefined) {
        compressed += thought.compression.compressed_tokens;
      } else {
        uncompressed += thoughtTokens;
      }
    }

    return {
      total: compressed + uncompressed,
      compressed,
      uncompressed,
    };
  }

  /** Store a pending thought that failed verification */
  setPendingThought(
    sessionId: string,
    thought: ThoughtRecord,
    verificationError: {
      issue: string;
      evidence: string;
      suggestions: string[];
      confidence: number;
      domain: string;
    },
  ): void {
    const session = this.getOrCreate(sessionId);
    session.pendingThought = { thought, verificationError };
    session.updated_at = Date.now();
  }

  /** Get pending thought for a session */
  getPendingThought(sessionId: string): Session["pendingThought"] {
    const session = this.get(sessionId);
    return session?.pendingThought;
  }

  /** Clear pending thought (after override or when replaced by revision) */
  clearPendingThought(sessionId: string): boolean {
    const session = this.get(sessionId);
    if (!session?.pendingThought) return false;
    session.pendingThought = undefined;
    session.updated_at = Date.now();
    return true;
  }

  /** Commit pending thought (used by override operation)
   * Atomic: only clears pending if addThought succeeds
   */
  commitPendingThought(sessionId: string): { success: boolean; error?: string } {
    const session = this.get(sessionId);
    if (!session?.pendingThought) {
      return { success: false, error: "No pending thought to commit" };
    }

    // Clone pending thought for restoration on failure
    const pendingCopy = session.pendingThought;

    const result = this.addThought(sessionId, pendingCopy.thought);
    if (result.success) {
      // Only clear pending if addThought succeeded
      session.pendingThought = undefined;
    }
    // If addThought failed, pending is preserved for retry/alternate recovery
    return result;
  }

  /** Store hint state for progressive reveals */
  setHintState(
    sessionId: string,
    state: {
      expression: string;
      revealCount: number;
      totalSteps: number;
      simplified: string;
    },
  ): void {
    const session = this.getOrCreate(sessionId);
    session.metadata.hintState = state;
    session.updated_at = Date.now();
  }

  /** Get hint state for a session */
  getHintState(sessionId: string): {
    expression: string;
    revealCount: number;
    totalSteps: number;
    simplified: string;
  } | null {
    const session = this.get(sessionId);
    const state = session?.metadata?.hintState;
    if (
      state &&
      typeof state === "object" &&
      "expression" in state &&
      "revealCount" in state &&
      "totalSteps" in state &&
      "simplified" in state
    ) {
      return state as {
        expression: string;
        revealCount: number;
        totalSteps: number;
        simplified: string;
      };
    }
    return null;
  }

  /** Clear hint state */
  clearHintState(sessionId: string): void {
    const session = this.get(sessionId);
    if (session?.metadata) {
      delete session.metadata.hintState;
      session.updated_at = Date.now();
    }
  }

  /** Store the original question for a session (for auto spot-check at complete) */
  setQuestion(sessionId: string, question: string): void {
    const session = this.getOrCreate(sessionId);
    // First-write-wins: don't overwrite existing question (prevents race condition)
    if (session.question) return;
    session.question = question;
    session.updated_at = Date.now();
  }

  /** Get the stored question for a session */
  getQuestion(sessionId: string): string | undefined {
    const session = this.get(sessionId);
    return session?.question;
  }

  /** Set the active session ID (server-side tracking) */
  setActiveSession(sessionId: string): void {
    this.activeSessionId = sessionId;
  }

  /** Get the active session ID (server-side tracking) */
  getActiveSession(): string | null {
    return this.activeSessionId;
  }

  /** Clear the active session ID */
  clearActiveSession(): void {
    this.activeSessionId = null;
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.sessions.clear();
  }
}

// Export class for testing
export { SessionManagerImpl };

// Singleton instance
export const SessionManager = new SessionManagerImpl();
