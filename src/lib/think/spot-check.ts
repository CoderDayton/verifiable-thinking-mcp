/**
 * Generalized Spot-Check for Trap Questions
 *
 * NO LLM calls - pure structural heuristics for <1ms overhead.
 * Detects trap patterns by STRUCTURE, not by problem NAME.
 *
 * Design principles:
 * 1. O(n) single-pass detection
 * 2. Structural pattern matching (not "bat and ball", but "additive system")
 * 3. Synthesizes warnings based on mathematical structure
 * 4. False positives OK - warns rather than corrects
 */

export interface SpotCheckResult {
  /** Whether the spot-check passed (no issues detected) */
  passed: boolean;
  /** Warning message if a potential trap was detected */
  warning: string | null;
  /** Hint for the LLM to reconsider */
  hint: string | null;
  /** Structural trap category (not problem name) */
  trapType: string | null;
  /** Confidence in the detection (0-1) */
  confidence: number;
}

export interface NeedsSpotCheckResult {
  /** Whether spot-check is recommended */
  required: boolean;
  /** Confidence score (0-1) */
  score: number;
  /** Detected structural categories */
  categories: string[];
}

// =============================================================================
// HELPERS
// =============================================================================

/** Extract all numbers from text */
function extractNumbers(text: string): number[] {
  const matches = text.match(/\d+(?:\.\d+)?/g);
  if (!matches) return [];
  return matches.map((m) => parseFloat(m));
}

/** Extract first number from text as float */
function extractFloat(text: string): number | null {
  const match = text.match(/(\d+(?:\.\d+)?)/);
  if (!match || match[1] === undefined) return null;
  return parseFloat(match[1]);
}

/** Count occurrences of each number */
function countNumbers(nums: number[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const n of nums) {
    counts.set(n, (counts.get(n) || 0) + 1);
  }
  return counts;
}

// =============================================================================
// FAST STRUCTURAL DETECTION (O(n) single-pass)
// =============================================================================

/**
 * Fast O(n) detection of whether a question needs spot-checking.
 * Based on STRUCTURAL signals, not problem names.
 */
export function needsSpotCheck(question: string): NeedsSpotCheckResult {
  const lower = question.toLowerCase();
  const categories: string[] = [];
  let score = 0;

  // 1. ADDITIVE SYSTEM: "total/sum" AND "more/less than"
  // Structure: x + y = T, x - y = D → trap is answering T - D
  if (/(?:total|sum|together|cost).*?(?:more|less)\s*than/i.test(lower)) {
    score += 0.8;
    categories.push("additive_system");
  }

  // 2. NON-LINEAR GROWTH: "doubles/triples" AND "half/fraction/percent"
  // Structure: exponential growth → trap is linear interpolation
  if (
    /doubles?|triples?|exponential/i.test(lower) &&
    /half|quarter|fraction|percent/i.test(lower)
  ) {
    score += 0.8;
    categories.push("nonlinear_growth");
  }

  // 3. RATE PATTERN: machines/workers + time + output
  // Structure: N machines, N minutes, N widgets → trap is scaling linearly
  if (
    /(\d+)\s*(?:machines?|workers?|people|printers?).*?(?:minutes?|hours?|days?|seconds?)/i.test(
      lower,
    )
  ) {
    score += 0.6;
    categories.push("rate_pattern");
  }

  // 4. HARMONIC MEAN: average speed + round trip/return
  // Structure: different speeds over same distance → trap is arithmetic mean
  if (
    /average\s*speed|speed.*average/i.test(lower) &&
    /(?:round\s*trip|return|back|there and back)/i.test(lower)
  ) {
    score += 0.9;
    categories.push("harmonic_mean");
  }

  // 5. INDEPENDENCE: sequence + probability of next
  // Structure: consecutive outcomes → trap is gambler's fallacy
  if (
    /(?:row|consecutive|straight|times)/i.test(lower) &&
    /(?:probability|chance|likely|odds)/i.test(lower)
  ) {
    score += 0.7;
    categories.push("independence");
  }

  // 6. PIGEONHOLE: minimum/least + guarantee/ensure
  // Structure: N categories, need match → trap is underestimating worst case
  if (/(?:minimum|least|fewest)/i.test(lower) && /(?:guarantee|ensure|certain|must)/i.test(lower)) {
    score += 0.7;
    categories.push("pigeonhole");
  }

  // 7. BASE RATE: test accuracy + rare condition
  // Structure: high accuracy + low prevalence → trap is ignoring base rate
  if (
    /(?:test|positive|negative)/i.test(lower) &&
    /(?:1\s*in\s*\d+|rare|uncommon|\d+%\s*(?:of|have))/i.test(lower)
  ) {
    score += 0.75;
    categories.push("base_rate");
  }

  // 8. FACTORIAL/COUNTING: n! + zeros/factors
  // Structure: large factorial → trap is simple division
  if (/\d+!/i.test(lower) && /(?:zero|factor|digit)/i.test(lower)) {
    score += 0.7;
    categories.push("factorial_counting");
  }

  // 9. CLOCK OVERLAP: clock + overlap/coincide
  // Structure: 12-hour period → trap is assuming 12 overlaps
  if (/clock/i.test(lower) && /(?:overlap|coincide|same position)/i.test(lower)) {
    score += 0.8;
    categories.push("clock_overlap");
  }

  // 10. CONDITIONAL PROBABILITY: given/if + probability
  // Structure: conditional setup → trap is ignoring conditioning
  if (
    /(?:given|if|knowing|after)/i.test(lower) &&
    /(?:probability|chance|what.*odds)/i.test(lower)
  ) {
    score += 0.6;
    categories.push("conditional_probability");
  }

  return {
    required: score >= 0.6,
    score: Math.min(1, score),
    categories,
  };
}

// =============================================================================
// GENERALIZED SPOT-CHECK (structural analysis)
// =============================================================================

/**
 * Run generalized spot-check on an answer.
 * Detects if answer matches "intuitive but wrong" patterns based on structure.
 */
export function spotCheck(question: string, answer: string): SpotCheckResult {
  const qNums = extractNumbers(question);
  const aNum = extractFloat(answer);

  // Can't analyze without numbers
  if (aNum === null || qNums.length === 0) {
    return passed();
  }

  const lower = question.toLowerCase();

  // Run structural checks in order of specificity
  return (
    checkAdditiveSystem(lower, qNums, aNum) ||
    checkNonlinearGrowth(lower, qNums, aNum) ||
    checkRatePattern(lower, qNums, aNum) ||
    checkHarmonicMean(lower, qNums, aNum) ||
    checkIndependence(lower, aNum) ||
    checkPigeonhole(lower, qNums, aNum) ||
    checkBaseRate(lower, qNums, aNum) ||
    checkFactorialZeros(lower, qNums, aNum) ||
    checkClockOverlap(lower, aNum) ||
    passed()
  );
}

// =============================================================================
// STRUCTURAL CHECKERS
// =============================================================================

function passed(): SpotCheckResult {
  return { passed: true, warning: null, hint: null, trapType: null, confidence: 0.5 };
}

function trap(type: string, warning: string, hint: string, confidence: number): SpotCheckResult {
  return { passed: false, warning, hint, trapType: type, confidence };
}

/**
 * ADDITIVE SYSTEM: x + y = Total, x = y + Diff
 * Trap: answering (Total - Diff) instead of (Total - Diff) / 2
 */
function checkAdditiveSystem(q: string, nums: number[], ans: number): SpotCheckResult | null {
  if (!/(?:total|sum|together|cost).*?(?:more|less)\s*than/i.test(q)) return null;
  if (nums.length < 2) return null;

  // Find total (usually largest) and difference
  const sorted = [...nums].sort((a, b) => b - a);
  const total = sorted[0];
  const diff = sorted[1];

  if (total === undefined || diff === undefined) return null;

  // Trap answer: Total - Diff (without halving)
  const trapAnswer = total - diff;
  const correctAnswer = (total - diff) / 2;

  // Check various unit representations (dollars vs cents, etc.)
  // trapAnswer might be 0.10, ans might be 10 (cents)
  const isTrapped =
    Math.abs(ans - trapAnswer) < 0.01 || // Same unit
    Math.abs(ans - trapAnswer * 100) < 0.5 || // Answer in cents, trap in dollars
    Math.abs(ans / 100 - trapAnswer) < 0.01; // Answer in dollars, trap in cents

  const isCorrect =
    Math.abs(ans - correctAnswer) < 0.01 ||
    Math.abs(ans - correctAnswer * 100) < 0.5 ||
    Math.abs(ans / 100 - correctAnswer) < 0.01;

  if (isTrapped && !isCorrect) {
    return trap(
      "additive_system",
      `Potential trap: ${ans} might be (${total} - ${diff}) without solving the system`,
      `This is a system: x + y = ${total}, x - y = ${diff}. Solve: y = (${total} - ${diff}) / 2 = ${correctAnswer}`,
      0.85,
    );
  }

  return null;
}

/**
 * NON-LINEAR GROWTH: doubles every period
 * Trap: answering Time/2 instead of Time-1 for "half full"
 */
function checkNonlinearGrowth(q: string, nums: number[], ans: number): SpotCheckResult | null {
  if (!/doubles?|triples?/i.test(q)) return null;
  if (!/half|quarter/i.test(q)) return null;

  // Find the time value (usually larger integer)
  const timeNums = nums.filter((n) => n > 5 && Number.isInteger(n));
  if (timeNums.length === 0) return null;

  const time = Math.max(...timeNums);

  // Trap answer: Time / 2 (linear thinking)
  if (Math.abs(ans - time / 2) < 0.5) {
    return trap(
      "nonlinear_growth",
      `Potential trap: ${ans} is ${time}/2, but exponential growth doesn't work linearly`,
      `If something doubles each period and is full at time ${time}, it was half-full at time ${time - 1}`,
      0.9,
    );
  }

  return null;
}

/**
 * RATE PATTERN: N machines, N minutes, N widgets
 * Trap: answering M when asked about M machines making M widgets
 */
function checkRatePattern(q: string, nums: number[], ans: number): SpotCheckResult | null {
  if (!/machines?|workers?|people|printers?/i.test(q)) return null;
  if (!/minutes?|hours?|seconds?/i.test(q)) return null;

  const counts = countNumbers(nums);

  // Look for the "setup" pattern: same number appears 3 times (N machines, N min, N widgets)
  let setupNum: number | null = null;
  for (const [num, count] of counts) {
    if (count >= 3) {
      setupNum = num;
      break;
    }
  }

  if (setupNum === null) return null;

  // Look for a different "target" number (M machines, M widgets)
  const targetNums = nums.filter((n) => n !== setupNum && counts.get(n)! >= 2);

  // Trap: answer equals target number (assumes time scales with count)
  for (const target of targetNums) {
    if (Math.abs(ans - target) < 0.1) {
      return trap(
        "rate_pattern",
        `Potential trap: ${ans} assumes time scales with quantity`,
        `If ${setupNum} machines make ${setupNum} widgets in ${setupNum} min, each machine makes 1 widget in ${setupNum} min. More machines = same time, more output.`,
        0.85,
      );
    }
  }

  return null;
}

/**
 * HARMONIC MEAN: average speed for round trip
 * Trap: using arithmetic mean (S1 + S2) / 2 instead of 2*S1*S2/(S1+S2)
 */
function checkHarmonicMean(q: string, nums: number[], ans: number): SpotCheckResult | null {
  if (!/average\s*speed|speed.*average/i.test(q)) return null;
  if (!/(?:round\s*trip|return|back)/i.test(q)) return null;

  // Filter likely speeds (< 200, probably not distances)
  const speeds = nums.filter((n) => n > 0 && n < 200);
  if (speeds.length < 2) return null;

  const s1 = speeds[0];
  const s2 = speeds[1];

  if (s1 === undefined || s2 === undefined || s1 === s2) return null;

  const arithmetic = (s1 + s2) / 2;
  const harmonic = (2 * s1 * s2) / (s1 + s2);

  // Trap: answer is arithmetic mean
  if (Math.abs(ans - arithmetic) < 0.5 && Math.abs(ans - harmonic) > 1) {
    return trap(
      "harmonic_mean",
      `Potential trap: ${ans} is the arithmetic mean (${s1}+${s2})/2`,
      `For round trips over fixed distance, use harmonic mean: 2×${s1}×${s2}/(${s1}+${s2}) = ${harmonic.toFixed(1)}`,
      0.9,
    );
  }

  return null;
}

/**
 * INDEPENDENCE: probability after streak
 * Trap: gambler's fallacy (thinking streak affects next outcome)
 */
function checkIndependence(q: string, ans: number): SpotCheckResult | null {
  if (!/coin|dice?|flip|roll/i.test(q)) return null;
  if (!/(?:row|consecutive|straight|times)/i.test(q)) return null;
  if (!/(?:probability|chance|likely)/i.test(q)) return null;

  // For fair coin, answer should be 50% (or 0.5)
  const is50 = Math.abs(ans - 50) < 2 || Math.abs(ans - 0.5) < 0.02;

  if (!is50 && ans > 0 && ans < 100) {
    return trap(
      "independence",
      `Potential gambler's fallacy: previous outcomes don't affect independent events`,
      `Each flip/roll is independent. Past results don't change future probability.`,
      0.8,
    );
  }

  return null;
}

/**
 * PIGEONHOLE: minimum to guarantee match
 * Trap: underestimating worst case
 */
function checkPigeonhole(q: string, nums: number[], ans: number): SpotCheckResult | null {
  if (!/(?:minimum|least|fewest)/i.test(q)) return null;
  if (!/(?:guarantee|ensure|certain)/i.test(q)) return null;
  if (!/(?:match|pair|same)/i.test(q)) return null;

  // For matching pair with N categories, answer is N+1
  // Common setup: 2 colors → need 3 items

  if (ans === 2) {
    return trap(
      "pigeonhole",
      `Potential trap: 2 items could all be different`,
      `Pigeonhole principle: with N categories, you need N+1 items to guarantee a match.`,
      0.85,
    );
  }

  // If answer seems too high (overthinking)
  const maxCategory = Math.max(...nums.filter((n) => n < 100));
  if (ans > maxCategory && maxCategory > 2) {
    return trap(
      "pigeonhole",
      `Potential trap: you don't need majority, just one more than categories`,
      `With ${maxCategory} categories (if that's the count), you need at most ${maxCategory + 1} to guarantee a match.`,
      0.7,
    );
  }

  return null;
}

/**
 * BASE RATE: test accuracy + rare condition
 * Trap: ignoring low prevalence (answering ~accuracy instead of Bayes result)
 */
function checkBaseRate(q: string, nums: number[], ans: number): SpotCheckResult | null {
  if (!/(?:test|positive|negative)/i.test(q)) return null;
  if (!/(?:probability|chance)/i.test(q)) return null;

  // Look for base rate pattern: "1 in N"
  const rateMatch = q.match(/1\s*(?:in|out of)\s*(\d+)/i);
  if (!rateMatch || !rateMatch[1]) return null;

  const denominator = parseInt(rateMatch[1], 10);
  const baseRate = 1 / denominator;

  // Look for accuracy (high percentage)
  const highPcts = nums.filter((n) => n >= 90 && n <= 100);
  const firstPct = highPcts[0];
  if (firstPct === undefined) return null;

  const accuracy = firstPct / 100;

  // Calculate Bayes result
  const pPosGivenDisease = accuracy;
  const pPosGivenNoDisease = 1 - accuracy;
  const pPositive = pPosGivenDisease * baseRate + pPosGivenNoDisease * (1 - baseRate);
  const bayesResult = (pPosGivenDisease * baseRate) / pPositive;

  // Normalize answer to percentage
  const ansPct = ans > 1 ? ans : ans * 100;

  // Trap: answer is close to accuracy, not Bayes result
  if (ansPct > 80 && bayesResult < 0.2) {
    return trap(
      "base_rate",
      `Potential base rate neglect: ${ansPct.toFixed(0)}% ignores the low prevalence (1 in ${denominator})`,
      `Apply Bayes: P(disease|positive) ≈ ${(bayesResult * 100).toFixed(0)}%, not ${(accuracy * 100).toFixed(0)}%`,
      0.85,
    );
  }

  return null;
}

/**
 * FACTORIAL ZEROS: trailing zeros in n!
 * Trap: simple division instead of counting factors of 5
 */
function checkFactorialZeros(q: string, _nums: number[], ans: number): SpotCheckResult | null {
  if (!/trailing.*zero|zero.*trailing/i.test(q)) return null;
  if (!/\d+!/i.test(q)) return null;

  // Find factorial argument
  const factMatch = q.match(/(\d+)!/);
  if (!factMatch || !factMatch[1]) return null;
  const n = parseInt(factMatch[1], 10);

  // Calculate correct answer (count factors of 5)
  let correct = 0;
  let power = 5;
  while (power <= n) {
    correct += Math.floor(n / power);
    power *= 5;
  }

  // Common traps: n/5 (missing higher powers) or n/10
  const simpleWrong = Math.floor(n / 5);
  const veryWrong = Math.floor(n / 10);

  if (Math.abs(ans - simpleWrong) < 0.5 && simpleWrong !== correct) {
    return trap(
      "factorial_counting",
      `Potential trap: ${ans} only counts single factors of 5`,
      `Count ALL factors of 5: ⌊n/5⌋ + ⌊n/25⌋ + ⌊n/125⌋ + ... = ${correct}`,
      0.85,
    );
  }

  if (Math.abs(ans - veryWrong) < 0.5 && veryWrong !== correct) {
    return trap(
      "factorial_counting",
      `Potential trap: trailing zeros come from factors of 5 (not 10)`,
      `Since 2s are abundant, count factors of 5: ${correct}`,
      0.8,
    );
  }

  return null;
}

/**
 * CLOCK OVERLAP: times hands overlap
 * Trap: assuming 12 or 24 overlaps instead of 11 or 22
 */
function checkClockOverlap(q: string, ans: number): SpotCheckResult | null {
  if (!/clock/i.test(q)) return null;
  if (!/(?:overlap|coincide)/i.test(q)) return null;
  if (!/(?:how many|times)/i.test(q)) return null;

  // 12-hour trap
  if (/12\s*hours?/i.test(q) && Math.abs(ans - 12) < 0.5) {
    return trap(
      "clock_overlap",
      `Potential trap: hands overlap 11 times in 12 hours, not 12`,
      `The 12:00 overlap is shared. Hands overlap every ~65.45 minutes → 11 times per 12 hours.`,
      0.9,
    );
  }

  // 24-hour trap
  if (/24\s*hours?/i.test(q) && Math.abs(ans - 24) < 0.5) {
    return trap(
      "clock_overlap",
      `Potential trap: hands overlap 22 times in 24 hours, not 24`,
      `11 overlaps per 12-hour period × 2 = 22 total.`,
      0.9,
    );
  }

  return null;
}

// =============================================================================
// LEGACY EXPORTS (for backwards compatibility)
// =============================================================================

/** @deprecated Use needsSpotCheck instead */
export function hasTrapPatterns(question: string): boolean {
  return needsSpotCheck(question).required;
}

export type TrapDetector = (question: string, answer: string) => SpotCheckResult | null;
