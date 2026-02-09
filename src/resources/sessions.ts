/**
 * Session Resources - Expose session data as MCP resources
 * Allows external tools to read reasoning chains
 */

import { SessionManager } from "../session/manager.ts";

/**
 * Resource template for accessing individual sessions
 * URI: session://{session_id}
 */
export const sessionResource = {
  name: "Session",
  uriTemplate: "session://{session_id}",
  description:
    "Access reasoning session data including thoughts, branches, and verification results",
  mimeType: "application/json",
  arguments: [
    {
      name: "session_id",
      description: "The session identifier",
      required: true,
    },
  ] as const,
  load: async (args: { session_id?: string }) => {
    const sessionId = args.session_id;
    if (!sessionId) {
      return {
        text: JSON.stringify({ error: "session_id is required" }),
      };
    }

    const session = SessionManager.get(sessionId);
    if (!session) {
      return {
        text: JSON.stringify({ error: `Session '${sessionId}' not found` }),
      };
    }

    const data = {
      id: session.id,
      created_at: new Date(session.created_at).toISOString(),
      updated_at: new Date(session.updated_at).toISOString(),
      branches: Array.from(session.branches),
      thought_count: session.thoughts.length,
      thoughts: session.thoughts.map((t) => ({
        id: t.id,
        step_number: t.step_number,
        branch_id: t.branch_id,
        thought: t.thought,
        timestamp: new Date(t.timestamp).toISOString(),
        verification: t.verification,
        concepts: t.concepts,
      })),
      metadata: session.metadata,
    };

    return {
      text: JSON.stringify(data, null, 2),
    };
  },
};

/**
 * Resource template for session summaries
 * URI: session://{session_id}/summary
 */
export const sessionSummaryResource = {
  name: "Session Summary",
  uriTemplate: "session://{session_id}/summary",
  description: "Get a text summary of a reasoning session",
  mimeType: "text/plain",
  arguments: [
    {
      name: "session_id",
      description: "The session identifier",
      required: true,
    },
  ] as const,
  load: async (args: { session_id?: string }) => {
    const sessionId = args.session_id;
    if (!sessionId) {
      return { text: "Error: session_id is required" };
    }

    const summary = SessionManager.getSummary(sessionId);
    if (!summary) {
      return { text: `Error: Session '${sessionId}' not found` };
    }

    return { text: summary };
  },
};

/**
 * Resource template for session branch data
 * URI: session://{session_id}/branch/{branch_id}
 */
export const sessionBranchResource = {
  name: "Session Branch",
  uriTemplate: "session://{session_id}/branch/{branch_id}",
  description: "Access thoughts from a specific branch in a session",
  mimeType: "application/json",
  arguments: [
    {
      name: "session_id",
      description: "The session identifier",
      required: true,
    },
    {
      name: "branch_id",
      description: "The branch identifier (default: main)",
      required: false,
    },
  ] as const,
  load: async (args: { session_id?: string; branch_id?: string }) => {
    const sessionId = args.session_id;
    const branchId = args.branch_id || "main";

    if (!sessionId) {
      return {
        text: JSON.stringify({ error: "session_id is required" }),
      };
    }

    const thoughts = SessionManager.getThoughts(sessionId, branchId);
    if (thoughts.length === 0) {
      const session = SessionManager.get(sessionId);
      if (!session) {
        return {
          text: JSON.stringify({ error: `Session '${sessionId}' not found` }),
        };
      }
      return {
        text: JSON.stringify({
          error: `Branch '${branchId}' not found or empty`,
          available_branches: Array.from(session.branches),
        }),
      };
    }

    const data = {
      session_id: sessionId,
      branch_id: branchId,
      thought_count: thoughts.length,
      thoughts: thoughts.map((t) => ({
        id: t.id,
        step_number: t.step_number,
        thought: t.thought,
        timestamp: new Date(t.timestamp).toISOString(),
        verification: t.verification,
        concepts: t.concepts,
      })),
    };

    return {
      text: JSON.stringify(data, null, 2),
    };
  },
};

/**
 * Static resource listing all active sessions
 */
export const sessionsListResource = {
  name: "Sessions List",
  uri: "session://list",
  description: "List all active reasoning sessions",
  mimeType: "application/json",
  load: async () => {
    const sessions = SessionManager.list();

    const data = {
      count: sessions.length,
      sessions: sessions.map((s) => ({
        id: s.id,
        thought_count: s.thought_count,
        branches: s.branches,
        age_seconds: Math.round(s.age_ms / 1000),
      })),
    };

    return {
      text: JSON.stringify(data, null, 2),
    };
  },
};

// Export all resources
export const allResources = [sessionsListResource];

export const allResourceTemplates = [
  sessionResource,
  sessionSummaryResource,
  sessionBranchResource,
];
