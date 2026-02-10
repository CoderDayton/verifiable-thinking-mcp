/**
 * Word problem solvers - extract math from natural language
 */

import { SolverType } from "../classifier.ts";
import { formatResult } from "../math.ts";
import { MULTI_STEP, WORD_PROBLEM_PATTERNS } from "../patterns.ts";
import type { ComputeResult, Entity, Solver } from "../types.ts";

// ============================================================================
// COGNITIVE REFLECTION TEST (CRT) PATTERNS
// These are classic "trap" problems that require algebraic setup
// ============================================================================

/**
 * Bat and Ball problem:
 * "A bat and ball cost $X total. The bat costs $Y more than the ball.
 *  How much does the ball cost?"
 *
 * Setup: ball = x, bat = x + Y, total = X
 * x + (x + Y) = X => 2x = X - Y => x = (X - Y) / 2
 */
const BAT_BALL_PATTERN =
  /(?:bat|racket|stick)\s+and\s+(?:a\s+)?ball\s+cost\s+\$?([\d.]+).*?(?:bat|racket|stick)\s+costs?\s+\$?([\d.]+)\s+more\s+than\s+(?:the\s+)?ball/i;

/**
 * Lily pad doubling problem:
 * "Lily pad doubles every day. Takes N days to cover lake.
 *  How many days to cover half?"
 *
 * Answer: N - 1 (if doubles on day N, half on day N-1)
 */
const LILY_PAD_PATTERN =
  /(?:lily\s*pad|patch|area)\s+(?:doubles|grows\s+twice).*?(\d+)\s+days?\s+to\s+cover\s+(?:the\s+)?(?:entire\s+)?(?:lake|pond|pool).*?(?:how\s+many\s+days?|when).*?(?:half|50%)/i;

/**
 * Widget machine problem:
 * "N machines take M minutes to make N widgets. How long for X machines to make X widgets?"
 *
 * Each machine makes 1 widget in M minutes. So X machines make X widgets in M minutes.
 * Answer: M (not X)
 */
const WIDGET_MACHINE_PATTERN =
  /(\d+)\s+machines?\s+(?:take|takes?)\s+(\d+)\s+minutes?\s+to\s+(?:make|produce)\s+\1\s+widgets?.*?(\d+)\s+machines?\s+(?:to\s+)?(?:make|produce)\s+\3\s+widgets?/i;

/**
 * Harmonic mean (round trip average speed):
 * "Goes A→B at X mph, returns at Y mph. Average speed?"
 *
 * Answer: 2*X*Y / (X+Y) (harmonic mean, not arithmetic mean)
 */
const HARMONIC_SPEED_PATTERN =
  /(?:goes|travels?|drives?)\s+.*?at\s+(\d+)\s*(?:mph|km\/h|kmh).*?(?:returns?|back)\s+(?:at\s+)?(\d+)\s*(?:mph|km\/h|kmh).*?average\s+speed/i;

/**
 * Achilles and Tortoise (catch-up problem):
 * "A moves at X m/s, B moves at Y m/s with Z head start. When does A catch B?"
 *
 * Time = head_start / (speed_A - speed_B)
 */
const CATCHUP_PATTERN =
  /(\d+)\s*(?:m\/s|mph|kmh).*?(\d+)\s*(?:m\/s|mph|kmh).*?(\d+)\s*(?:m|meter|mile|km)\s*(?:head\s*start|ahead)/i;

/**
 * Pigeonhole/sock drawer problem:
 * "N items of type A, M items of type B. Minimum draws to guarantee a pair?"
 *
 * Answer: number_of_types + 1
 */
const SOCK_DRAWER_PATTERN =
  /(\d+)\s+(\w+)\s+(?:socks?|balls?|items?)\s+and\s+(\d+)\s+(\w+)\s+(?:socks?|balls?|items?).*?(?:minimum|least|fewest).*?(?:guarantee|ensure|certain)/i;

/**
 * Try Cognitive Reflection Test style problems
 */
export function tryCRTProblem(text: string): ComputeResult {
  const start = performance.now();
  const lower = text.toLowerCase();

  // Bat and Ball
  const batBall = text.match(BAT_BALL_PATTERN);
  if (batBall?.[1] && batBall[2]) {
    const total = parseFloat(batBall[1]);
    const diff = parseFloat(batBall[2]);
    // ball + (ball + diff) = total => ball = (total - diff) / 2
    const ballCost = (total - diff) / 2;
    if (ballCost >= 0 && Number.isFinite(ballCost)) {
      // Check if asking for cents
      const wantsCents = /cents?|¢/i.test(text);
      const result = wantsCents ? Math.round(ballCost * 100) : ballCost;
      return {
        solved: true,
        result: formatResult(result),
        method: "crt_bat_ball",
        confidence: 0.98,
        time_ms: performance.now() - start,
      };
    }
  }

  // Lily Pad doubling
  const lilyPad = text.match(LILY_PAD_PATTERN);
  if (lilyPad?.[1]) {
    const totalDays = parseInt(lilyPad[1], 10);
    // Half coverage is one day before full coverage
    const halfDays = totalDays - 1;
    return {
      solved: true,
      result: String(halfDays),
      method: "crt_lily_pad",
      confidence: 0.98,
      time_ms: performance.now() - start,
    };
  }

  // Widget Machine
  const widget = text.match(WIDGET_MACHINE_PATTERN);
  if (widget?.[2]) {
    // N machines make N widgets in M minutes means 1 machine makes 1 widget in M minutes
    // So X machines make X widgets in M minutes (not X minutes!)
    const minutes = parseInt(widget[2], 10);
    return {
      solved: true,
      result: String(minutes),
      method: "crt_widget",
      confidence: 0.98,
      time_ms: performance.now() - start,
    };
  }

  // Harmonic mean (round trip speed)
  const harmonic = text.match(HARMONIC_SPEED_PATTERN);
  if (harmonic?.[1] && harmonic[2]) {
    const speed1 = parseFloat(harmonic[1]);
    const speed2 = parseFloat(harmonic[2]);
    // Harmonic mean: 2 * s1 * s2 / (s1 + s2)
    const avgSpeed = (2 * speed1 * speed2) / (speed1 + speed2);
    return {
      solved: true,
      result: formatResult(avgSpeed),
      method: "crt_harmonic",
      confidence: 0.98,
      time_ms: performance.now() - start,
    };
  }

  // Catch-up problem (Achilles/Tortoise style)
  const catchup = text.match(CATCHUP_PATTERN);
  if (catchup?.[1] && catchup[2] && catchup[3]) {
    const speed1 = parseFloat(catchup[1]);
    const speed2 = parseFloat(catchup[2]);
    const headStart = parseFloat(catchup[3]);
    if (speed1 > speed2) {
      const time = headStart / (speed1 - speed2);
      // Round to nearest integer if close
      const result = Math.abs(time - Math.round(time)) < 0.01 ? Math.round(time) : time;
      return {
        solved: true,
        result: formatResult(result),
        method: "crt_catchup",
        confidence: 0.95,
        time_ms: performance.now() - start,
      };
    }
  }

  // Sock drawer / pigeonhole
  const sockMatch = text.match(SOCK_DRAWER_PATTERN);
  if (sockMatch?.[2] && sockMatch[4] && /pair|matching/i.test(lower)) {
    // With N types of items, need N+1 draws to guarantee a pair
    const type1 = sockMatch[2].toLowerCase();
    const type2 = sockMatch[4].toLowerCase();
    // Count distinct types
    const types = new Set([type1, type2]);
    const minDraws = types.size + 1;
    return {
      solved: true,
      result: String(minDraws),
      method: "crt_pigeonhole",
      confidence: 0.95,
      time_ms: performance.now() - start,
    };
  }

  return { solved: false, confidence: 0 };
}

/**
 * Try to solve a word problem using pattern matching
 */
export function tryWordProblem(text: string): ComputeResult {
  const start = performance.now();

  for (const { pattern, compute, method } of WORD_PROBLEM_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const result = compute(match);
      if (result !== null && Number.isFinite(result)) {
        const time_ms = performance.now() - start;
        return {
          solved: true,
          result: formatResult(result),
          method,
          confidence: 0.95, // Slightly lower confidence for word problems
          time_ms,
        };
      }
    }
  }

  return { solved: false, confidence: 0 };
}

// =============================================================================
// MULTI-STEP WORD PROBLEM HELPERS (extracted to reduce cognitive complexity)
// =============================================================================

type OperationFn = (x: number) => number;

/** Extract simple binary relations (twice, half, triple) */
function extractSimpleRelation(
  text: string,
  pattern: RegExp,
  operation: OperationFn,
  entities: Map<string, Entity>,
): void {
  const regex = new RegExp(pattern.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const name1 = match[1]?.toLowerCase();
    const name2 = match[2]?.toLowerCase();
    if (name1 && name2 && !entities.has(name1)) {
      entities.set(name1, { name: name1, value: null, dependsOn: name2, operation });
      if (!entities.has(name2)) {
        entities.set(name2, { name: name2, value: null, dependsOn: null, operation: null });
      }
    }
  }
}

/** Extract delta relations (more, less) where match[2] contains the delta */
function extractDeltaRelation(
  text: string,
  pattern: RegExp,
  sign: 1 | -1,
  entities: Map<string, Entity>,
): void {
  const regex = new RegExp(pattern.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const name1 = match[1]?.toLowerCase();
    const deltaStr = match[2];
    const name2 = match[3]?.toLowerCase();
    if (name1 && deltaStr && name2 && !entities.has(name1)) {
      const delta = parseFloat(deltaStr);
      entities.set(name1, {
        name: name1,
        value: null,
        dependsOn: name2,
        operation: (x) => x + sign * delta,
      });
      if (!entities.has(name2)) {
        entities.set(name2, { name: name2, value: null, dependsOn: null, operation: null });
      }
    }
  }
}

/** Extract direct values "[Name] has [number]" */
function extractDirectValues(text: string, entities: Map<string, Entity>): void {
  const regex = new RegExp(MULTI_STEP.directValue.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1]?.toLowerCase();
    const valueStr = match[2];
    if (name && valueStr) {
      const value = parseFloat(valueStr);
      const existing = entities.get(name);
      if (!existing) {
        entities.set(name, { name, value, dependsOn: null, operation: null });
      } else if (existing.value === null && !existing.dependsOn) {
        existing.value = value;
      }
    }
  }
}

/** Resolve entity dependencies via topological iteration */
function resolveDependencies(entities: Map<string, Entity>): void {
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 10) {
    changed = false;
    iterations++;
    for (const entity of entities.values()) {
      if (entity.value === null && entity.dependsOn && entity.operation) {
        const dep = entities.get(entity.dependsOn);
        if (dep?.value !== null && dep?.value !== undefined) {
          entity.value = entity.operation(dep.value);
          changed = true;
        }
      }
    }
  }
}

/** Try to answer a specific entity question */
function tryAnswerEntityQuestion(
  text: string,
  entities: Map<string, Entity>,
  start: number,
): ComputeResult | null {
  const questionMatch = text.match(MULTI_STEP.question);
  if (questionMatch?.[1]) {
    const entity = entities.get(questionMatch[1].toLowerCase());
    if (entity?.value !== null && entity?.value !== undefined) {
      return {
        solved: true,
        result: formatResult(entity.value),
        method: "multi_step_word",
        confidence: 0.9,
        time_ms: performance.now() - start,
      };
    }
  }
  return null;
}

/** Try to answer a "total" question */
function tryAnswerTotalQuestion(
  lower: string,
  entities: Map<string, Entity>,
  start: number,
): ComputeResult | null {
  if (!/total|altogether|combined|sum/i.test(lower) || entities.size === 0) return null;

  let total = 0;
  for (const entity of entities.values()) {
    if (entity.value === null) return null; // Not all resolved
    total += entity.value;
  }

  return {
    solved: true,
    result: formatResult(total),
    method: "multi_step_total",
    confidence: 0.85,
    time_ms: performance.now() - start,
  };
}

/**
 * Try to solve multi-step word problems by extracting entities and resolving dependencies
 * E.g., "John has twice as many as Mary, who has 5. How many does John have?"
 */
export function tryMultiStepWordProblem(text: string): ComputeResult {
  const start = performance.now();
  const lower = text.toLowerCase();
  const entities: Map<string, Entity> = new Map();

  // Extract relations (order matters: specific patterns first)
  extractSimpleRelation(text, MULTI_STEP.twice, (x) => x * 2, entities);
  extractSimpleRelation(text, MULTI_STEP.half, (x) => x / 2, entities);
  extractSimpleRelation(text, MULTI_STEP.triple, (x) => x * 3, entities);
  extractDeltaRelation(text, MULTI_STEP.more, 1, entities);
  extractDeltaRelation(text, MULTI_STEP.less, -1, entities);

  // Extract direct values last
  extractDirectValues(text, entities);

  // Resolve dependencies
  resolveDependencies(entities);

  // Try to answer
  return (
    tryAnswerEntityQuestion(text, entities, start) ||
    tryAnswerTotalQuestion(lower, entities, start) || { solved: false, confidence: 0 }
  );
}

// =============================================================================
// SOLVER REGISTRATION
// =============================================================================

export const solvers: Solver[] = [
  {
    name: "crt_word",
    description:
      "Cognitive Reflection Test traps: bat-ball, lily pad doubling, widget machines, harmonic mean, catch-up, pigeonhole",
    types: SolverType.WORD_PROBLEM,
    priority: 25, // After formula, before regular word problems (more specific)
    solve: (text, _lower) => tryCRTProblem(text),
  },
  {
    name: "word_problem",
    description: "Simple word problems: age, distance, percentage increase/decrease, profit",
    types: SolverType.WORD_PROBLEM,
    priority: 30,
    solve: (text, _lower) => tryWordProblem(text),
  },
  {
    name: "multi_step_word",
    description: "Multi-step word problems with entity relationships (twice as many, N more than)",
    types: SolverType.MULTI_STEP,
    priority: 40,
    solve: (text, _lower) => tryMultiStepWordProblem(text),
  },
];
