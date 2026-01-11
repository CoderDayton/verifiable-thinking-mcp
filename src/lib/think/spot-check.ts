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

  // 11. CONJUNCTION FALLACY: "and" probability vs single event
  // Structure: specific description → trap is thinking more detail = more likely
  if (
    /(?:more likely|which.*probable|what.*probability)/i.test(lower) &&
    /(?:and|both|also)/i.test(lower) &&
    /(?:bank teller|feminist|active|personality|description)/i.test(lower)
  ) {
    score += 0.8;
    categories.push("conjunction_fallacy");
  }

  // 12. MONTY HALL: switch vs stay, doors/boxes/curtains
  // Structure: revealed option → trap is thinking 50/50
  if (
    /(?:door|box|curtain|envelope)/i.test(lower) &&
    /(?:switch|stay|change|keep)/i.test(lower) &&
    /(?:reveal|open|show)/i.test(lower)
  ) {
    score += 0.85;
    categories.push("monty_hall");
  }

  // 13. ANCHORING: estimation after seeing a number
  // Structure: irrelevant number shown before estimation task
  if (
    /(?:estimate|guess|how (?:many|much|long))/i.test(lower) &&
    /(?:spin|wheel|number|digit|wrote|shown)/i.test(lower)
  ) {
    score += 0.6;
    categories.push("anchoring");
  }

  // 14. SUNK COST: already invested + should continue?
  // Structure: past investment + decision about future action
  if (
    /(?:already|spent|invested|paid|cost)/i.test(lower) &&
    /(?:should|continue|keep|stop|quit|abandon|walk away)/i.test(lower)
  ) {
    score += 0.75;
    categories.push("sunk_cost");
  }

  // 15. FRAMING EFFECT: same outcome with gain/loss framing
  // Structure: presents options as "X will be saved" vs "Y will die"
  if (
    (/(?:save|saved|survive|lives?)/i.test(lower) || /(?:die|death|lost|killed)/i.test(lower)) &&
    /(?:program|option|choice|treatment|plan) [ab]/i.test(lower)
  ) {
    score += 0.7;
    categories.push("framing_effect");
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
  const lower = question.toLowerCase();

  // Text-based checks (don't require numbers in answer)
  const textCheck =
    checkConjunctionFallacy(lower, answer) ||
    checkMontyHall(lower, aNum, answer) ||
    checkSunkCost(lower, answer) ||
    checkFramingEffect(lower, answer);

  if (textCheck) return textCheck;

  // Number-based checks require numbers
  if (aNum === null || qNums.length === 0) {
    return passed();
  }

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

/**
 * CONJUNCTION FALLACY: Linda problem structure
 * Trap: thinking specific conjunction is more likely than general case
 */
function checkConjunctionFallacy(q: string, answer: string): SpotCheckResult | null {
  if (!/(?:more likely|which.*probable|what.*probability)/i.test(q)) return null;

  const ansLower = answer.toLowerCase();

  // Check if question has an "and" option (conjunction)
  const hasConjunctionOption = /(?:and|both|as well)/i.test(q);
  if (!hasConjunctionOption) return null;

  // Check if answer chooses the conjunction option
  // Match patterns like: "B", "option B", "bank teller and", "and feminist", etc.
  const choosesConjunction =
    /\b[bB]\b/.test(answer) || // Chose option B (common format)
    /(?:and|both|as well)/i.test(ansLower); // Answer contains conjunction

  if (choosesConjunction) {
    return trap(
      "conjunction_fallacy",
      `Potential conjunction fallacy: P(A and B) ≤ P(A) always`,
      `A conjunction cannot be more probable than either of its parts. The more specific option is LESS likely.`,
      0.85,
    );
  }

  return null;
}

/**
 * MONTY HALL: switch vs stay
 * Trap: thinking it's 50/50 after door is revealed
 */
function checkMontyHall(q: string, ans: number | null, answer: string): SpotCheckResult | null {
  // Detect Monty Hall by name OR by structure
  const isMontyHall =
    /monty\s*hall/i.test(q) ||
    (/(?:door|box|curtain)/i.test(q) &&
      /(?:switch|stay|change|keep)/i.test(q) &&
      /(?:reveal|open|show|goat)/i.test(q));

  if (!isMontyHall) return null;

  const ansLower = answer.toLowerCase();

  // If question asks for probability and answer is 50%
  if (/(?:probability|chance)/i.test(q) && ans !== null) {
    if (Math.abs(ans - 50) < 2 || Math.abs(ans - 0.5) < 0.02) {
      return trap(
        "monty_hall",
        `Potential Monty Hall trap: it's NOT 50/50 after a door is revealed`,
        `Switching wins 2/3 of the time, staying wins 1/3. The reveal gives you information.`,
        0.9,
      );
    }
  }

  // If question asks whether to switch, and answer is "stay" or "doesn't matter"
  if (/(?:should|better|strategy)/i.test(q)) {
    if (/(?:stay|keep|doesn't matter|50.?50|same|either)/i.test(ansLower)) {
      return trap(
        "monty_hall",
        `Potential Monty Hall trap: switching is actually the better strategy`,
        `Switching wins 2/3 of the time. The host's reveal changes the odds.`,
        0.85,
      );
    }
  }

  return null;
}

/**
 * SUNK COST FALLACY: decision influenced by past investment
 * Trap: continuing based on what was already spent, not future value
 */
function checkSunkCost(q: string, answer: string): SpotCheckResult | null {
  // Detect sunk cost structure: past investment + decision about future
  if (!/(?:already|spent|invested|paid|cost)/i.test(q)) return null;
  if (!/(?:should|continue|keep|stop|quit|abandon|walk away|finish)/i.test(q)) return null;

  const ansLower = answer.toLowerCase();

  // Check if answer references past investment as justification
  const referencesPastInvestment =
    /(?:already spent|already invested|can't waste|too much invested|come this far|so much into)/i.test(
      ansLower,
    ) ||
    // Or explicitly says "continue because of" past spending
    /(?:continue|keep going|finish).*(?:because|since).*(?:spent|invested|paid)/i.test(ansLower);

  // Also detect the common trap answers
  const commonTrapAnswers =
    // "Yes, continue" without proper justification
    (/^(?:yes|continue|keep|finish)/i.test(ansLower.trim()) &&
      !/(?:future value|expected return|profitable going forward|worth it regardless)/i.test(
        ansLower,
      )) ||
    // Explicit sunk cost reasoning
    /(?:wasted|thrown away|lost|for nothing)/i.test(ansLower);

  if (referencesPastInvestment || commonTrapAnswers) {
    return trap(
      "sunk_cost",
      `Potential sunk cost fallacy: past investment shouldn't influence future decisions`,
      `Sunk costs are gone - focus on whether FUTURE benefits justify FUTURE costs. What's already spent is irrelevant.`,
      0.8,
    );
  }

  return null;
}

/**
 * FRAMING EFFECT: decision influenced by gain vs loss presentation
 * Trap: different choice based on how options are framed
 */
function checkFramingEffect(q: string, answer: string): SpotCheckResult | null {
  // Detect framing effect structure: same outcome presented differently
  const hasFramingSignals =
    (/(?:save|saved|survive|lives?)/i.test(q) || /(?:die|death|lost|killed)/i.test(q)) &&
    /(?:program|option|choice|treatment|plan) [ab]/i.test(q);

  if (!hasFramingSignals) return null;

  const ansLower = answer.toLowerCase();

  // Classic Asian Disease Problem structure:
  // - Gain frame: "200 saved" vs "1/3 chance all saved, 2/3 none saved"
  // - Loss frame: "400 die" vs "1/3 none die, 2/3 all die"
  // These are mathematically equivalent!

  // Check if answer shows framing bias
  // In gain frame, people prefer certain option (A)
  // In loss frame, people prefer risky option (B)

  // Detect if question has gain framing (focus on "saved/survive")
  const isGainFrame = /(?:save|saved|survive)/i.test(q) && !/(?:die|death|killed)/i.test(q);

  // Detect if question has loss framing (focus on "die/death")
  const isLossFrame = /(?:die|death|killed)/i.test(q) && !/(?:save|saved|survive)/i.test(q);

  // If someone chooses based on framing without recognizing equivalence
  if (isGainFrame || isLossFrame) {
    // Check if answer acknowledges framing effect or just picks
    const acknowledgesFraming =
      /(?:equivalent|same|framing|mathematically|expected value|doesn't matter)/i.test(ansLower);

    if (!acknowledgesFraming) {
      // If they just picked without considering the math
      const pickedOption = /\b[ab]\b/i.test(ansLower);
      if (pickedOption) {
        return trap(
          "framing_effect",
          `Potential framing effect: check if options are mathematically equivalent`,
          `The way choices are presented (lives saved vs lives lost) often triggers different intuitive responses to identical expected outcomes. Calculate expected values to decide rationally.`,
          0.7,
        );
      }
    }
  }

  return null;
}

// =============================================================================
// TRAP PRIMING (proactive guidance before reasoning)
// =============================================================================

/**
 * Configuration for smart priming behavior.
 * Based on benchmark analysis showing:
 * - Single-trap priming: 0 regressions
 * - Multi-trap priming: 1 regression (Monty Hall confusion)
 */
export interface PrimeOptions {
  /** Minimum detection confidence to trigger priming (default: 0.7) */
  minConfidence?: number;

  /**
   * Maximum traps to combine into prompt (default: 1 = single-trap only)
   * Set to 1 for conservative mode (safest), 2-3 for aggressive mode.
   * Benchmark showed multi-trap priming can confuse models.
   */
  maxCombined?: number;

  /** Trap types to exclude from priming (model handles well without help) */
  excludeTypes?: string[];
}

/** Default conservative options - single-trap only, proven safe */
export const PRIME_DEFAULTS: Required<PrimeOptions> = {
  minConfidence: 0.7,
  maxCombined: 1,
  excludeTypes: [],
};

/** Aggressive priming - use with caution, may cause regressions */
export const PRIME_AGGRESSIVE: Required<PrimeOptions> = {
  minConfidence: 0.6,
  maxCombined: 2,
  excludeTypes: [],
};

export interface PrimeResult {
  /** Whether priming is recommended */
  shouldPrime: boolean;
  /** Detected trap types (all detected, before filtering) */
  trapTypes: string[];
  /** Trap types actually used for priming (after filtering) */
  primedTypes: string[];
  /** Short nudge to prepend (<20 tokens for single, <50 for combined) */
  primingPrompt: string | null;
  /** Individual prompts for each detected trap */
  allPrompts: string[];
  /** Confidence in detection (0-1) */
  confidence: number;
  /** Whether priming was skipped due to options (confidence too low, excluded type, etc.) */
  skippedReason: string | null;
}

/** Priming prompts for each trap type - kept under 20 tokens */
const PRIMING_PROMPTS: Record<string, string> = {
  additive_system: "⚠️ System of equations detected. Define variables x,y and solve algebraically.",
  nonlinear_growth: "⚠️ Exponential growth. Work backwards from the end state, not forwards.",
  rate_pattern: "⚠️ Rate problem. Calculate rate per unit first, then scale.",
  harmonic_mean: "⚠️ Round trip speed. Use harmonic mean: 2ab/(a+b), not arithmetic.",
  independence: "⚠️ Independent events. Past outcomes don't affect future probability.",
  pigeonhole: "⚠️ Guarantee problem. Consider worst case: need categories + 1.",
  base_rate: "⚠️ Rare condition + test. Apply Bayes' theorem with base rate.",
  factorial_counting: "⚠️ Factorial zeros. Count factors of 5: ⌊n/5⌋ + ⌊n/25⌋ + ...",
  clock_overlap: "⚠️ Clock hands overlap 11 times per 12 hours, not 12.",
  conditional_probability: "⚠️ Conditional probability. Use P(A|B) = P(A∩B)/P(B).",
  conjunction_fallacy: "⚠️ Conjunction trap. P(A and B) ≤ P(A) always.",
  monty_hall: "⚠️ Revealed information changes odds. Switching wins 2/3.",
  anchoring: "⚠️ Ignore irrelevant numbers. Base estimate on actual data only.",
  sunk_cost: "⚠️ Sunk cost trap. Past spending is irrelevant to future decisions.",
  framing_effect: "⚠️ Check framing. Calculate expected values for both options.",
};

/**
 * Analyze a question BEFORE reasoning to detect potential cognitive traps.
 * Returns a priming prompt to inject preventive guidance.
 *
 * Smart priming based on benchmark analysis:
 * - Single-trap priming had 0 regressions across 41 questions
 * - Multi-trap priming caused 1 regression (model confusion)
 * - Default: conservative single-trap mode (maxCombined=1)
 *
 * O(n) single-pass - no LLM calls.
 *
 * @param question - The question to analyze
 * @param options - Smart priming configuration (or number for backward compat)
 */
export function primeQuestion(question: string, options?: PrimeOptions | number): PrimeResult {
  // Backward compatibility: number = maxCombined
  const opts: Required<PrimeOptions> =
    typeof options === "number"
      ? { ...PRIME_DEFAULTS, maxCombined: options }
      : { ...PRIME_DEFAULTS, ...options };

  const detection = needsSpotCheck(question);

  // No traps detected
  if (!detection.required || detection.categories.length === 0) {
    return {
      shouldPrime: false,
      trapTypes: [],
      primedTypes: [],
      primingPrompt: null,
      allPrompts: [],
      confidence: detection.score,
      skippedReason: "no_traps_detected",
    };
  }

  // Confidence below threshold
  if (detection.score < opts.minConfidence) {
    return {
      shouldPrime: false,
      trapTypes: detection.categories,
      primedTypes: [],
      primingPrompt: null,
      allPrompts: [],
      confidence: detection.score,
      skippedReason: `confidence_below_threshold:${detection.score.toFixed(2)}<${opts.minConfidence}`,
    };
  }

  // Filter out excluded trap types
  const filteredCategories = detection.categories.filter((cat) => !opts.excludeTypes.includes(cat));

  // All traps excluded
  if (filteredCategories.length === 0) {
    return {
      shouldPrime: false,
      trapTypes: detection.categories,
      primedTypes: [],
      primingPrompt: null,
      allPrompts: [],
      confidence: detection.score,
      skippedReason: `all_types_excluded:${detection.categories.join(",")}`,
    };
  }

  // Collect prompts for filtered traps (up to maxCombined)
  const trapsToInclude = filteredCategories.slice(0, opts.maxCombined);
  const allPrompts: string[] = [];

  for (const trap of trapsToInclude) {
    const prompt = PRIMING_PROMPTS[trap];
    if (prompt) {
      allPrompts.push(prompt);
    }
  }

  // No prompts available for detected traps
  if (allPrompts.length === 0) {
    return {
      shouldPrime: false,
      trapTypes: detection.categories,
      primedTypes: [],
      primingPrompt: null,
      allPrompts: [],
      confidence: detection.score,
      skippedReason: `no_prompts_for_types:${trapsToInclude.join(",")}`,
    };
  }

  // Combine prompts: single trap uses full prompt, multi-trap uses condensed format
  let primingPrompt: string | null = null;
  if (allPrompts.length === 1) {
    primingPrompt = allPrompts[0] ?? null;
  } else if (allPrompts.length > 1) {
    // For multi-trap, use numbered list format
    primingPrompt = allPrompts.map((p, i) => `${i + 1}. ${p.replace("⚠️ ", "")}`).join("\n");
  }

  return {
    shouldPrime: true,
    trapTypes: detection.categories,
    primedTypes: trapsToInclude,
    primingPrompt,
    allPrompts,
    confidence: detection.score,
    skippedReason: null,
  };
}

// =============================================================================
// LEGACY EXPORTS (for backwards compatibility)
// =============================================================================

/** @deprecated Use needsSpotCheck instead */
export function hasTrapPatterns(question: string): boolean {
  return needsSpotCheck(question).required;
}

export type TrapDetector = (question: string, answer: string) => SpotCheckResult | null;
