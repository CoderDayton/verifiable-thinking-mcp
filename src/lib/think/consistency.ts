/**
 * Consistency Checker - O(n) lightweight contradiction detection
 *
 * Detects obvious contradictions across reasoning steps:
 * - Variable reassignment (x=5 then x=10)
 * - Logical conflicts (always vs never, all vs none)
 * - Sign/direction flips (positive→negative, increasing→decreasing)
 *
 * Keeps complexity O(n) by single-pass extraction + map-based comparison.
 */

/** A detected contradiction between reasoning steps */
export interface Contradiction {
  /** Type of contradiction found */
  type: "value_reassignment" | "logical_conflict" | "sign_flip" | "direction_reversal";
  /** Human-readable description */
  description: string;
  /** The variable/concept involved */
  subject: string;
  /** Step where original claim was made */
  original_step: number;
  /** Value/state in original step */
  original_value: string;
  /** Step where contradiction occurred */
  conflicting_step: number;
  /** Conflicting value/state */
  conflicting_value: string;
  /** Confidence in detection (0-1) */
  confidence: number;
}

/** Result of consistency check */
export interface ConsistencyResult {
  /** Whether any contradictions were found */
  has_contradictions: boolean;
  /** List of detected contradictions */
  contradictions: Contradiction[];
  /** Number of steps analyzed */
  steps_analyzed: number;
}

// Patterns for extracting variable assignments
// Matches: x = 5, x = 10, let x = 3, x := 7
const ASSIGNMENT_PATTERN = /(?:let\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*[:=]=?\s*(-?\d+(?:\.\d+)?)/g;

// Patterns for logical absolutes
const LOGICAL_ABSOLUTES: Record<string, string[]> = {
  always: ["never", "sometimes", "rarely"],
  never: ["always", "sometimes", "often"],
  all: ["none", "some", "few"],
  none: ["all", "some", "many"],
  every: ["no", "some", "few"],
  must: ["cannot", "might", "may not"],
  cannot: ["must", "can", "might"],
  true: ["false"],
  false: ["true"],
  impossible: ["possible", "certain", "likely"],
  certain: ["impossible", "uncertain", "unlikely"],
};

// Patterns for sign/direction words
const SIGN_WORDS: Record<string, string[]> = {
  positive: ["negative", "zero"],
  negative: ["positive", "zero"],
  increasing: ["decreasing", "constant"],
  decreasing: ["increasing", "constant"],
  greater: ["less", "equal"],
  less: ["greater", "equal"],
  above: ["below", "at"],
  below: ["above", "at"],
};

/** Internal tracking structure for a claim */
interface ClaimRecord {
  step: number;
  value: string;
  context: string; // surrounding words for confidence
}

/**
 * Extract variable assignments from text
 * O(n) where n = text length
 */
function extractAssignments(text: string, stepNum: number): Map<string, ClaimRecord> {
  const result = new Map<string, ClaimRecord>();
  let match: RegExpExecArray | null;

  // Reset regex state
  ASSIGNMENT_PATTERN.lastIndex = 0;

  while ((match = ASSIGNMENT_PATTERN.exec(text)) !== null) {
    const varName = match[1]?.toLowerCase();
    const value = match[2];
    if (!varName || !value) continue;
    // Get surrounding context (20 chars each side)
    const start = Math.max(0, match.index - 20);
    const end = Math.min(text.length, match.index + match[0].length + 20);
    const context = text.slice(start, end);

    result.set(varName, { step: stepNum, value, context });
  }

  return result;
}

/**
 * Extract logical absolute claims from text
 * O(n) where n = text length
 *
 * Strategy: Extract the word itself, look for conflicts later
 */
function extractLogicalClaims(text: string, stepNum: number): Map<string, ClaimRecord> {
  const result = new Map<string, ClaimRecord>();
  const lowerText = text.toLowerCase();

  for (const [word, _conflicts] of Object.entries(LOGICAL_ABSOLUTES)) {
    // Word boundary match
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    if (regex.test(lowerText)) {
      // Get context around the word
      const match = lowerText.indexOf(word);
      const start = Math.max(0, match - 30);
      const end = Math.min(text.length, match + word.length + 30);
      const context = text.slice(start, end);

      // Simple key: just the word type (always, never, etc)
      // We'll check conflicts based on value, not key matching
      const key = `logical:${word}`;
      result.set(key, { step: stepNum, value: word, context });
    }
  }

  return result;
}

/**
 * Extract sign/direction claims from text
 * O(n) where n = text length
 */
function extractSignClaims(text: string, stepNum: number): Map<string, ClaimRecord> {
  const result = new Map<string, ClaimRecord>();
  const lowerText = text.toLowerCase();

  for (const [word, _conflicts] of Object.entries(SIGN_WORDS)) {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    if (regex.test(lowerText)) {
      const match = lowerText.indexOf(word);
      const start = Math.max(0, match - 30);
      const end = Math.min(text.length, match + word.length + 30);
      const context = text.slice(start, end);

      // Include nearby noun/subject for specificity
      // But use the word itself as the key for conflict matching
      const varMatch = context.match(/\b(the\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\b/i);
      const subject = varMatch ? varMatch[2] || "value" : "value";
      const key = `sign:${word}`;
      result.set(key, { step: stepNum, value: word, context: `${subject}: ${context}` });
    }
  }

  return result;
}

/**
 * Check for contradictions between two claims
 */
function findContradiction(
  key: string,
  oldClaim: ClaimRecord,
  newClaim: ClaimRecord,
): Contradiction | null {
  // Value reassignment check
  if (key.match(/^[a-z_][a-z0-9_]*$/i)) {
    // Simple variable name - check if values differ
    if (oldClaim.value !== newClaim.value) {
      return {
        type: "value_reassignment",
        description: `Variable '${key}' was ${oldClaim.value} in step ${oldClaim.step}, now ${newClaim.value}`,
        subject: key,
        original_step: oldClaim.step,
        original_value: oldClaim.value,
        conflicting_step: newClaim.step,
        conflicting_value: newClaim.value,
        confidence: 0.9,
      };
    }
  }

  // Logical conflict check
  if (key.startsWith("logical:")) {
    const conflicts = LOGICAL_ABSOLUTES[oldClaim.value];
    if (conflicts?.includes(newClaim.value)) {
      return {
        type: "logical_conflict",
        description: `Logical conflict: '${oldClaim.value}' in step ${oldClaim.step} vs '${newClaim.value}' in step ${newClaim.step}`,
        subject: key.split(":")[2] || "claim",
        original_step: oldClaim.step,
        original_value: oldClaim.value,
        conflicting_step: newClaim.step,
        conflicting_value: newClaim.value,
        confidence: 0.85,
      };
    }
  }

  // Sign flip check
  if (key.startsWith("sign:")) {
    const conflicts = SIGN_WORDS[oldClaim.value];
    if (conflicts?.includes(newClaim.value)) {
      const subject = key.split(":")[1] || "value";
      return {
        type: "sign_flip",
        description: `Sign flip for '${subject}': ${oldClaim.value} → ${newClaim.value}`,
        subject,
        original_step: oldClaim.step,
        original_value: oldClaim.value,
        conflicting_step: newClaim.step,
        conflicting_value: newClaim.value,
        confidence: 0.8,
      };
    }
  }

  return null;
}

/**
 * Check consistency across reasoning steps
 *
 * O(n*m) where n = total text length, m = number of steps
 * Practically O(n) since m is bounded by session limits
 *
 * @param steps - Array of thought texts with step numbers
 * @returns Consistency check result
 */
export function checkConsistency(
  steps: Array<{ step: number; thought: string }>,
): ConsistencyResult {
  if (steps.length < 2) {
    return {
      has_contradictions: false,
      contradictions: [],
      steps_analyzed: steps.length,
    };
  }

  const contradictions: Contradiction[] = [];

  // Track all claims across steps
  const allAssignments = new Map<string, ClaimRecord>();
  // For logical/sign, track by value (the word itself) to find conflicts
  const allLogicalByValue = new Map<string, ClaimRecord>();
  const allSignsByValue = new Map<string, ClaimRecord>();

  for (const { step, thought } of steps) {
    // Extract claims from this step
    const assignments = extractAssignments(thought, step);
    const logical = extractLogicalClaims(thought, step);
    const signs = extractSignClaims(thought, step);

    // Check for contradictions with previous steps - variable reassignment
    for (const [key, claim] of assignments) {
      const existing = allAssignments.get(key);
      if (existing && existing.step !== step) {
        const contradiction = findContradiction(key, existing, claim);
        if (contradiction) {
          contradictions.push(contradiction);
        }
      }
      // Update or set the claim (latest wins for tracking)
      allAssignments.set(key, claim);
    }

    // Logical conflicts: check if this step's words conflict with prior words
    for (const [_key, claim] of logical) {
      const conflicts = LOGICAL_ABSOLUTES[claim.value];
      if (conflicts) {
        // Check if any conflicting word was seen in a prior step
        for (const conflictWord of conflicts) {
          const existing = allLogicalByValue.get(conflictWord);
          if (existing && existing.step !== step) {
            contradictions.push({
              type: "logical_conflict",
              description: `Logical conflict: '${existing.value}' in step ${existing.step} vs '${claim.value}' in step ${step}`,
              subject: "claim",
              original_step: existing.step,
              original_value: existing.value,
              conflicting_step: step,
              conflicting_value: claim.value,
              confidence: 0.85,
            });
          }
        }
      }
      allLogicalByValue.set(claim.value, claim);
    }

    // Sign conflicts: check if this step's words conflict with prior words
    for (const [_key, claim] of signs) {
      const conflicts = SIGN_WORDS[claim.value];
      if (conflicts) {
        for (const conflictWord of conflicts) {
          const existing = allSignsByValue.get(conflictWord);
          if (existing && existing.step !== step) {
            // Extract subject from context
            const subjectMatch = claim.context.match(/^([^:]+):/);
            const subject = subjectMatch?.[1] ?? "value";
            contradictions.push({
              type: "sign_flip",
              description: `Sign flip for '${subject}': ${existing.value} → ${claim.value}`,
              subject,
              original_step: existing.step,
              original_value: existing.value,
              conflicting_step: step,
              conflicting_value: claim.value,
              confidence: 0.8,
            });
          }
        }
      }
      allSignsByValue.set(claim.value, claim);
    }
  }

  return {
    has_contradictions: contradictions.length > 0,
    contradictions,
    steps_analyzed: steps.length,
  };
}

/**
 * Quick check if a new step contradicts any previous steps
 * More efficient for incremental checking
 *
 * @param newStep - The new step to check
 * @param priorSteps - Previous steps to check against
 * @returns Array of contradictions (empty if none)
 */
export function checkStepConsistency(
  newStep: { step: number; thought: string },
  priorSteps: Array<{ step: number; thought: string }>,
): Contradiction[] {
  const result = checkConsistency([...priorSteps, newStep]);
  // Only return contradictions involving the new step
  return result.contradictions.filter((c) => c.conflicting_step === newStep.step);
}
