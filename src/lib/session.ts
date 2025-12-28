/**
 * Session Manager - Thread-safe session state with TTL cleanup
 * Stores reasoning chains per session for multi-turn verification
 */

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
}

export interface Session {
  id: string;
  created_at: number;
  updated_at: number;
  thoughts: ThoughtRecord[];
  branches: Set<string>;
  metadata: Record<string, unknown>;
}

interface SessionManagerConfig {
  ttl_ms: number;        // Time-to-live for sessions
  cleanup_interval_ms: number;
  max_sessions: number;
}

const DEFAULT_CONFIG: SessionManagerConfig = {
  ttl_ms: 30 * 60 * 1000,           // 30 minutes
  cleanup_interval_ms: 5 * 60 * 1000, // 5 minutes
  max_sessions: 100,
};

class SessionManagerImpl {
  private sessions: Map<string, Session> = new Map();
  private config: SessionManagerConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

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

  private cleanup(): void {
    const now = Date.now();
    const expired: string[] = [];
    
    for (const [id, session] of this.sessions) {
      if (now - session.updated_at > this.config.ttl_ms) {
        expired.push(id);
      }
    }
    
    for (const id of expired) {
      this.sessions.delete(id);
    }
  }

  getOrCreate(sessionId: string): Session {
    let session = this.sessions.get(sessionId);
    
    if (!session) {
      // Enforce max sessions limit
      if (this.sessions.size >= this.config.max_sessions) {
        // Remove oldest session
        let oldest: [string, Session] | null = null;
        for (const entry of this.sessions) {
          if (!oldest || entry[1].updated_at < oldest[1].updated_at) {
            oldest = entry;
          }
        }
        if (oldest) this.sessions.delete(oldest[0]);
      }
      
      session = {
        id: sessionId,
        created_at: Date.now(),
        updated_at: Date.now(),
        thoughts: [],
        branches: new Set(["main"]),
        metadata: {},
      };
      this.sessions.set(sessionId, session);
    }
    
    return session;
  }

  get(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.updated_at = Date.now(); // Touch on access
    }
    return session;
  }

  addThought(sessionId: string, thought: ThoughtRecord): void {
    const session = this.getOrCreate(sessionId);
    session.thoughts.push(thought);
    session.branches.add(thought.branch_id);
    session.updated_at = Date.now();
  }

  getThoughts(sessionId: string, branchId?: string): ThoughtRecord[] {
    const session = this.get(sessionId);
    if (!session) return [];
    
    if (branchId) {
      return session.thoughts.filter(t => t.branch_id === branchId);
    }
    return session.thoughts;
  }

  getBranches(sessionId: string): string[] {
    const session = this.get(sessionId);
    return session ? Array.from(session.branches) : [];
  }

  list(): { id: string; thought_count: number; branches: string[]; age_ms: number }[] {
    const now = Date.now();
    return Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      thought_count: s.thoughts.length,
      branches: Array.from(s.branches),
      age_ms: now - s.created_at,
    }));
  }

  clear(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  clearAll(): number {
    const count = this.sessions.size;
    this.sessions.clear();
    return count;
  }

  getSummary(sessionId: string): string | null {
    const session = this.get(sessionId);
    if (!session) return null;
    
    const lines: string[] = [
      `Session: ${sessionId}`,
      `Thoughts: ${session.thoughts.length}`,
      `Branches: ${Array.from(session.branches).join(", ")}`,
      "",
    ];
    
    for (const thought of session.thoughts) {
      const v = thought.verification;
      const status = v ? (v.passed ? "+" : "x") : "?";
      lines.push(`[${status}] Step ${thought.step_number} (${thought.branch_id}): ${thought.thought.slice(0, 80)}...`);
    }
    
    return lines.join("\n");
  }

  getCompressed(sessionId: string): string | null {
    const session = this.get(sessionId);
    if (!session) return null;
    
    // Return only key thoughts (verified or final)
    const key = session.thoughts.filter(t => 
      t.verification?.passed || 
      t.step_number === Math.max(...session.thoughts.map(x => x.step_number))
    );
    
    return key.map(t => t.thought).join(" -> ");
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
