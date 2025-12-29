/**
 * Benchmark Types - Shared types for benchmark runner and verification
 */

// ============================================================================
// QUESTION TYPES
// ============================================================================

export interface Question {
  id: string;
  category: "math" | "logic" | "code" | "reasoning";
  difficulty: "easy" | "medium" | "hard" | "trap" | "impossible" | "sota";
  question: string;
  expected_answer: string | string[];
  verification_type: "exact" | "contains" | "regex" | "numeric" | "code_exec";
  tolerance?: number;
}

export interface QuestionSet {
  version: string;
  description: string;
  questions: Question[];
}

// ============================================================================
// RESULT TYPES
// ============================================================================

export interface BaselineResult {
  answer: string;
  correct: boolean;
  time_ms: number;
  tokens_estimate: number;
  method?: "local" | "llm";
}

export interface ToolResult {
  answer: string;
  correct: boolean;
  time_ms: number;
  tokens_estimate: number;
  steps: number;
  checkpoints: number;
  risk_flags: string[];
  method?: "local" | "llm";
  compression?: {
    bytes_saved: number;
    input_compressed: boolean;
    output_compressed: boolean;
    context_compressed: boolean;
  };
}

export interface RunResult {
  question_id: string;
  difficulty: string;
  category: string;
  baseline: BaselineResult;
  with_tool: ToolResult;
}

export interface BenchmarkSummary {
  baseline: {
    correct: number;
    total: number;
    accuracy: number;
    avg_time_ms: number;
  };
  with_tool: {
    correct: number;
    total: number;
    accuracy: number;
    avg_time_ms: number;
  };
  by_difficulty: Record<
    string,
    { baseline_accuracy: number; tool_accuracy: number; delta: number }
  >;
  by_category: Record<string, { baseline_accuracy: number; tool_accuracy: number; delta: number }>;
  compression?: {
    total_bytes_saved: number;
    steps_compressed: number;
    avg_bytes_per_step: number;
  };
}

export interface BenchmarkResults {
  timestamp: string;
  model: string;
  total_questions: number;
  results: RunResult[];
  summary: BenchmarkSummary;
}
