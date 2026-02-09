import { z } from "zod";
import { clearTracker } from "../session/concepts.ts";
import { SessionManager } from "../session/manager.ts";
import { calculateTokenUsage } from "../text/tokens.ts";

/**
 * Session management tools for reasoning chains
 */

export const listSessionsTool = {
  name: "list_sessions",
  description: "List active sessions with counts/branches",
  parameters: z.object({}),
  execute: async () => {
    const args = {};
    const sessions = SessionManager.list();

    let result: string;
    if (sessions.length === 0) {
      result = "No active sessions.";
    } else {
      const lines = [
        `**Active Sessions** (${sessions.length})`,
        "",
        "| Session | Thoughts | Branches | Age |",
        "|---------|----------|----------|-----|",
      ];

      for (const s of sessions) {
        const age = formatAge(s.age_ms);
        lines.push(
          `| ${s.id.slice(0, 20)}... | ${s.thought_count} | ${s.branches.join(", ")} | ${age} |`,
        );
      }
      result = lines.join("\n");
    }

    const tokens = calculateTokenUsage(args, result);
    return `${result}\n\n---\n_tokens: ${tokens.input_tokens} in, ${tokens.output_tokens} out, ${tokens.total_tokens} total_`;
  },
};

export const getSessionTool = {
  name: "get_session",
  description: "Get session: full/summary/compressed format",
  parameters: z.object({
    session_id: z.string().optional().describe("Session ID (uses active if omitted)"),
    format: z
      .enum(["full", "summary", "compressed"])
      .default("summary")
      .describe("Format: full (all), summary (overview), compressed (key only)"),
    branch_id: z.string().optional().describe("Filter by branch ID"),
  }),
  execute: async (args: { session_id?: string; format?: string; branch_id?: string }) => {
    // Use active session if not specified
    const sessionId = args.session_id || SessionManager.getActiveSession();
    if (!sessionId) {
      return "No session ID provided and no active session found.";
    }

    const session = SessionManager.get(sessionId);

    let result: string;
    if (!session) {
      result = `Session not found: ${sessionId}`;
    } else {
      const format = args.format || "summary";

      if (format === "compressed") {
        result = SessionManager.getCompressed(sessionId) || "No thoughts to compress.";
      } else if (format === "summary") {
        result = SessionManager.getSummary(sessionId) || "No summary available.";
      } else {
        // Full format
        const thoughts = args.branch_id
          ? SessionManager.getThoughts(sessionId, args.branch_id)
          : SessionManager.getThoughts(sessionId);

        if (thoughts.length === 0) {
          result = "No thoughts in session.";
        } else {
          const lines = [
            `**Session**: ${sessionId}`,
            `**Branches**: ${Array.from(session.branches).join(", ")}`,
            `**Thoughts**: ${thoughts.length}`,
            "",
          ];

          for (const t of thoughts) {
            const v = t.verification;
            const status = v ? (v.passed ? "✓" : "✗") : "○";
            const confidence = v ? ` (${Math.round(v.confidence * 100)}%)` : "";

            lines.push(`### Step ${t.step_number} [${t.branch_id}] ${status}${confidence}`);
            lines.push(t.thought);

            if (t.concepts && t.concepts.length > 0) {
              lines.push(`*Concepts: ${t.concepts.join(", ")}*`);
            }
            lines.push("");
          }
          result = lines.join("\n");
        }
      }
    }

    const tokens = calculateTokenUsage(args, result);
    return `${result}\n\n---\n_tokens: ${tokens.input_tokens} in, ${tokens.output_tokens} out, ${tokens.total_tokens} total_`;
  },
};

export const clearSessionTool = {
  name: "clear_session",
  description: "Clear session(s) to free memory",
  parameters: z.object({
    session_id: z.string().optional().describe("Session ID to clear (omit for all)"),
    all: z.boolean().default(false).describe("Clear all sessions"),
  }),
  execute: async (args: { session_id?: string; all?: boolean }) => {
    let result: string;

    if (args.all) {
      const count = SessionManager.clearAll();
      result = `Cleared ${count} session(s).`;
    } else if (!args.session_id) {
      result = "Provide session_id or set all=true";
    } else {
      // Also clear concept tracker for this session
      clearTracker(args.session_id);

      const cleared = SessionManager.clear(args.session_id);
      result = cleared
        ? `Cleared session: ${args.session_id}`
        : `Session not found: ${args.session_id}`;
    }

    const tokens = calculateTokenUsage(args, result);
    return `${result}\n\n---\n_tokens: ${tokens.input_tokens} in, ${tokens.output_tokens} out, ${tokens.total_tokens} total_`;
  },
};

function formatAge(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}
