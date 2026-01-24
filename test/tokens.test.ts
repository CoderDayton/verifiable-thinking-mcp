import { afterEach, describe, expect, test } from "bun:test";
import { SessionManager } from "../src/lib/session.ts";
import { calculateTokenUsage, estimateObjectTokens, estimateTokens } from "../src/lib/tokens.ts";

describe("Token estimation", () => {
  test("estimateTokens returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  test("estimateTokens uses tiktoken for accurate counting (not ~4 chars/token)", () => {
    // 100 'a' chars = 13 tokens with tiktoken o200k_base (not 25 with old 4 char/token estimation)
    const text = "a".repeat(100);
    expect(estimateTokens(text)).toBe(13);
  });

  test("estimateTokens uses tiktoken regardless of model parameter (model param is ignored)", () => {
    const text = "a".repeat(100);

    // All models now use tiktoken o200k_base -> same result (13 tokens)
    expect(estimateTokens(text, "claude-3-opus")).toBe(13);
    expect(estimateTokens(text, "llama-3")).toBe(13);
    expect(estimateTokens(text, "gpt-4")).toBe(13);
  });

  test("estimateTokens uses exact tiktoken counts", () => {
    // "hello" = 1 token with tiktoken (not 2 with old ceil(5/4) estimation)
    expect(estimateTokens("hello")).toBe(1);
  });

  test("estimateObjectTokens handles null/undefined", () => {
    expect(estimateObjectTokens(null)).toBe(0);
    expect(estimateObjectTokens(undefined)).toBe(0);
  });

  test("estimateObjectTokens uses tiktoken on serialized object", () => {
    const obj = { foo: "bar", count: 42 };
    // JSON.stringify(obj) = '{"foo":"bar","count":42}' = 24 chars
    // tiktoken counts this as 9 tokens (not 6 with old ceil(24/4) estimation)
    expect(estimateObjectTokens(obj)).toBe(9);
  });

  test("calculateTokenUsage returns input, output, and total", () => {
    const input = { operation: "step", thought: "test" };
    const output = { session_id: "abc", status: "continue" };

    const usage = calculateTokenUsage(input, output);

    expect(usage.input_tokens).toBeGreaterThan(0);
    expect(usage.output_tokens).toBeGreaterThan(0);
    expect(usage.total_tokens).toBe(usage.input_tokens + usage.output_tokens);
  });

  test("calculateTokenUsage uses tiktoken for accurate token counts", () => {
    const input = {};
    const output = "No active sessions.";

    const usage = calculateTokenUsage(input, output);

    // "{}" = 1 token with tiktoken (not 1 with old ceil(2/4))
    expect(usage.input_tokens).toBe(1);
    // "No active sessions." (20 chars) = 4 tokens with tiktoken (not 6 with old ceil(20/4))
    expect(usage.output_tokens).toBe(4);
  });
});

describe("Session token tracking", () => {
  afterEach(() => {
    SessionManager.clearAll();
  });

  test("SessionManager.getTokenUsage accumulates usage", () => {
    const sessionId = "test-session-1";
    const session = SessionManager.getOrCreate(sessionId);

    // First operation
    session.tokenUsage.input += 10;
    session.tokenUsage.output += 20;
    session.tokenUsage.operations += 1;

    const first = SessionManager.getTokenUsage(sessionId);
    expect(first).not.toBeNull();
    expect(first!.total_input).toBe(10);
    expect(first!.total_output).toBe(20);
    expect(first!.total).toBe(30);
    expect(first!.operations).toBe(1);

    // Second operation
    session.tokenUsage.input += 15;
    session.tokenUsage.output += 25;
    session.tokenUsage.operations += 1;

    const second = SessionManager.getTokenUsage(sessionId);
    expect(second!.total_input).toBe(25);
    expect(second!.total_output).toBe(45);
    expect(second!.total).toBe(70);
    expect(second!.operations).toBe(2);
  });

  test("SessionManager.getTokenUsage returns zero object for unknown session (backward compat)", () => {
    const usage = SessionManager.getTokenUsage("nonexistent");
    expect(usage).not.toBeNull();
    expect(usage.total).toBe(0);
  });

  test("SessionManager.getTokenUsage returns tracked usage", () => {
    const sessionId = "test-session-2";
    const session = SessionManager.getOrCreate(sessionId);

    session.tokenUsage.input += 5;
    session.tokenUsage.output += 10;
    session.tokenUsage.operations += 1;

    const usage = SessionManager.getTokenUsage(sessionId);
    expect(usage).not.toBeNull();
    expect(usage?.total).toBe(15);
  });

  test("SessionManager.clear removes session (getTokenUsage returns zeros after)", () => {
    const sessionId = "test-session-3";
    const session = SessionManager.getOrCreate(sessionId);

    session.tokenUsage.input += 5;
    session.tokenUsage.output += 10;
    session.tokenUsage.operations += 1;

    expect(SessionManager.clear(sessionId)).toBe(true);
    // After clear, returns zero object (not null) for backward compat
    const usage = SessionManager.getTokenUsage(sessionId);
    expect(usage.total).toBe(0);
    expect(SessionManager.clear(sessionId)).toBe(false); // Already cleared
  });

  test("SessionManager.clearAll clears all sessions", () => {
    const sessionA = SessionManager.getOrCreate("session-a");
    sessionA.tokenUsage.input += 1;
    sessionA.tokenUsage.output += 2;
    sessionA.tokenUsage.operations += 1;

    const sessionB = SessionManager.getOrCreate("session-b");
    sessionB.tokenUsage.input += 4;
    sessionB.tokenUsage.output += 5;
    sessionB.tokenUsage.operations += 1;

    const cleared = SessionManager.clearAll();
    expect(cleared).toBe(2);

    // After clearAll, returns zero objects (not null) for backward compat
    expect(SessionManager.getTokenUsage("session-a").total).toBe(0);
    expect(SessionManager.getTokenUsage("session-b").total).toBe(0);
  });

  test("SessionManager token tracking works across success and error operations", () => {
    const sessionId = "error-test-session";
    const session = SessionManager.getOrCreate(sessionId);

    // First operation succeeds
    session.tokenUsage.input += 50;
    session.tokenUsage.output += 100;
    session.tokenUsage.operations += 1;

    // Second operation errors (should still track)
    session.tokenUsage.input += 30;
    session.tokenUsage.output += 20; // Error responses are smaller
    session.tokenUsage.operations += 1;

    const usage = SessionManager.getTokenUsage(sessionId);
    expect(usage).not.toBeNull();
    expect(usage?.total_input).toBe(80);
    expect(usage?.total_output).toBe(120);
    expect(usage?.total).toBe(200);
    expect(usage?.operations).toBe(2);
  });
});

describe("Hard limit budget check", () => {
  afterEach(() => {
    SessionManager.clearAll();
  });

  test("SessionManager.getTokenUsage returns usage for budget check", () => {
    const sessionId = "budget-check-session";
    const session = SessionManager.getOrCreate(sessionId);

    // Simulate several operations accumulating tokens
    session.tokenUsage.input += 100;
    session.tokenUsage.output += 200;
    session.tokenUsage.operations += 1;

    session.tokenUsage.input += 150;
    session.tokenUsage.output += 250;
    session.tokenUsage.operations += 1;

    session.tokenUsage.input += 100;
    session.tokenUsage.output += 200;
    session.tokenUsage.operations += 1;

    const usage = SessionManager.getTokenUsage(sessionId);
    expect(usage).not.toBeNull();
    expect(usage?.total).toBe(1000); // 300 + 400 + 300

    // This pattern is used by hard_limit_tokens check
    const hardLimit = 800;
    expect(usage!.total >= hardLimit).toBe(true);
  });

  test("budget check returns zero usage for non-existent session", () => {
    // getTokenUsage for non-existent returns zero object (not null) for backward compat
    const usage = SessionManager.getTokenUsage("new-session-no-history");
    expect(usage).not.toBeNull();
    expect(usage.total).toBe(0);
  });

  test("budget check allows operations under limit", () => {
    const sessionId = "under-limit-session";
    const session = SessionManager.getOrCreate(sessionId);

    session.tokenUsage.input += 50;
    session.tokenUsage.output += 100;
    session.tokenUsage.operations += 1;

    const usage = SessionManager.getTokenUsage(sessionId);
    const hardLimit = 1000;

    // Under limit - should allow
    expect(usage!.total < hardLimit).toBe(true);
  });
});
