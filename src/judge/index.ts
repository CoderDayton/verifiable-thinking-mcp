/**
 * LLM-as-Judge: Compare two responses and score quality
 *
 * Uses a separate LLM call to evaluate response quality on multiple dimensions.
 * Designed for open-ended questions where exact-match verification isn't possible.
 */

export interface JudgeResult {
  /** Which response is better: "A", "B", or "tie" */
  winner: "A" | "B" | "tie";
  /** Confidence in the judgment (0-1) */
  confidence: number;
  /** Scores per dimension (1-5 scale) */
  scores: {
    A: DimensionScores;
    B: DimensionScores;
  };
  /** Brief explanation of the judgment */
  reasoning: string;
  /** Raw judge response for debugging */
  raw_response?: string;
}

export interface DimensionScores {
  /** Is the response factually correct and accurate? */
  accuracy: number;
  /** Is the reasoning logical and well-structured? */
  reasoning_quality: number;
  /** Does the response fully address the question? */
  completeness: number;
  /** Is the response clear and well-written? */
  clarity: number;
  /** Overall quality score */
  overall: number;
}

export interface JudgeInput {
  /** The original question/prompt */
  question: string;
  /** Response A (typically baseline) */
  response_a: string;
  /** Response B (typically with tool) */
  response_b: string;
  /** Optional reference answer for grounding */
  reference_answer?: string;
  /** Optional category for domain-specific judging */
  category?: string;
}

/**
 * System prompt for the judge LLM
 */
const JUDGE_SYSTEM_PROMPT = `You are an expert evaluator comparing two AI responses to the same question.

Your task is to evaluate both responses on these dimensions (1-5 scale):
1. **Accuracy**: Factual correctness, no hallucinations or errors
2. **Reasoning Quality**: Logical flow, clear step-by-step thinking
3. **Completeness**: Fully addresses the question, no missing parts
4. **Clarity**: Well-written, easy to understand
5. **Overall**: Holistic quality assessment

IMPORTANT RULES:
- Be objective and fair to both responses
- If a reference answer is provided, use it as ground truth
- Consider the question type when weighing dimensions
- Explain your reasoning briefly

OUTPUT FORMAT (JSON only, no markdown):
{
  "scores_a": { "accuracy": N, "reasoning_quality": N, "completeness": N, "clarity": N, "overall": N },
  "scores_b": { "accuracy": N, "reasoning_quality": N, "completeness": N, "clarity": N, "overall": N },
  "winner": "A" | "B" | "tie",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation"
}`;

/**
 * Build the user prompt for the judge
 */
function buildJudgePrompt(input: JudgeInput): string {
  let prompt = `QUESTION:\n${input.question}\n\n`;

  if (input.reference_answer) {
    prompt += `REFERENCE ANSWER:\n${input.reference_answer}\n\n`;
  }

  prompt += `RESPONSE A:\n${input.response_a}\n\n`;
  prompt += `RESPONSE B:\n${input.response_b}\n\n`;

  if (input.category) {
    prompt += `CATEGORY: ${input.category} (weight accuracy higher for math/logic)\n\n`;
  }

  prompt += `Evaluate both responses and output JSON only.`;

  return prompt;
}

/**
 * Parse the judge's response into structured result
 */
function parseJudgeResponse(response: string): Omit<JudgeResult, "raw_response"> | null {
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate structure
    if (!parsed.scores_a || !parsed.scores_b || !parsed.winner) {
      return null;
    }

    const mapScores = (s: Record<string, number>): DimensionScores => ({
      accuracy: s.accuracy || 3,
      reasoning_quality: s.reasoning_quality || 3,
      completeness: s.completeness || 3,
      clarity: s.clarity || 3,
      overall: s.overall || 3,
    });

    return {
      winner: parsed.winner as "A" | "B" | "tie",
      confidence: parsed.confidence || 0.5,
      scores: {
        A: mapScores(parsed.scores_a),
        B: mapScores(parsed.scores_b),
      },
      reasoning: parsed.reasoning || "No reasoning provided",
    };
  } catch {
    return null;
  }
}

/**
 * Judge function type - allows different LLM backends
 */
export type LLMJudgeFunc = (prompt: string, system: string) => Promise<string>;

/**
 * Compare two responses using LLM-as-Judge
 *
 * @param input - The question and two responses to compare
 * @param llmCall - Function to call the judge LLM
 * @returns Structured judgment result
 */
export async function judgeResponses(
  input: JudgeInput,
  llmCall: LLMJudgeFunc,
): Promise<JudgeResult> {
  const prompt = buildJudgePrompt(input);
  const response = await llmCall(prompt, JUDGE_SYSTEM_PROMPT);

  const parsed = parseJudgeResponse(response);

  if (!parsed) {
    // Fallback for unparseable response
    return {
      winner: "tie",
      confidence: 0,
      scores: {
        A: { accuracy: 3, reasoning_quality: 3, completeness: 3, clarity: 3, overall: 3 },
        B: { accuracy: 3, reasoning_quality: 3, completeness: 3, clarity: 3, overall: 3 },
      },
      reasoning: "Failed to parse judge response",
      raw_response: response,
    };
  }

  return {
    ...parsed,
    raw_response: response,
  };
}

/**
 * Batch judge multiple response pairs
 */
export async function judgeBatch(
  inputs: JudgeInput[],
  llmCall: LLMJudgeFunc,
  options: { concurrency?: number } = {},
): Promise<JudgeResult[]> {
  const { concurrency = 3 } = options;
  const results: JudgeResult[] = [];

  // Process in batches for rate limiting
  for (let i = 0; i < inputs.length; i += concurrency) {
    const batch = inputs.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((input) => judgeResponses(input, llmCall)));
    results.push(...batchResults);
  }

  return results;
}

/**
 * Aggregate judge results into summary statistics
 */
export interface JudgeSummary {
  total: number;
  wins_a: number;
  wins_b: number;
  ties: number;
  win_rate_a: number;
  win_rate_b: number;
  avg_scores_a: DimensionScores;
  avg_scores_b: DimensionScores;
  avg_confidence: number;
}

export function summarizeJudgments(results: JudgeResult[]): JudgeSummary {
  const total = results.length;
  if (total === 0) {
    return {
      total: 0,
      wins_a: 0,
      wins_b: 0,
      ties: 0,
      win_rate_a: 0,
      win_rate_b: 0,
      avg_scores_a: { accuracy: 0, reasoning_quality: 0, completeness: 0, clarity: 0, overall: 0 },
      avg_scores_b: { accuracy: 0, reasoning_quality: 0, completeness: 0, clarity: 0, overall: 0 },
      avg_confidence: 0,
    };
  }

  const wins_a = results.filter((r) => r.winner === "A").length;
  const wins_b = results.filter((r) => r.winner === "B").length;
  const ties = results.filter((r) => r.winner === "tie").length;

  const avgScores = (key: "A" | "B"): DimensionScores => {
    const dims: (keyof DimensionScores)[] = [
      "accuracy",
      "reasoning_quality",
      "completeness",
      "clarity",
      "overall",
    ];
    const avg: Partial<DimensionScores> = {};
    for (const dim of dims) {
      avg[dim] = results.reduce((sum, r) => sum + r.scores[key][dim], 0) / total;
    }
    return avg as DimensionScores;
  };

  return {
    total,
    wins_a,
    wins_b,
    ties,
    win_rate_a: wins_a / total,
    win_rate_b: wins_b / total,
    avg_scores_a: avgScores("A"),
    avg_scores_b: avgScores("B"),
    avg_confidence: results.reduce((sum, r) => sum + r.confidence, 0) / total,
  };
}
