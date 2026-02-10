#!/usr/bin/env python3
"""
Math Example: Local Compute with Prompt Injection

Demonstrates how verifiable_thinking pre-computes mathematical expressions
and injects results into prompts before sending to the LLM.

Benefits:
- ~0.02ms per computation (vs ~500ms LLM call)
- 100% accuracy on supported operations
- Reduces LLM arithmetic errors
- Domain-aware filtering prevents false positives

Run this script to see example injections:
    python examples/math_example.py

To test with actual TypeScript implementation:
    cd /path/to/verifiable_thinking
    bun -e "
    import { extractAndCompute } from './src/compute';
    console.log(extractAndCompute('Calculate 17 + 28 for the total.'));
    "
"""

# =============================================================================
# REAL EXAMPLES - These are actual outputs from the local compute engine
# =============================================================================

INJECTION_EXAMPLES = [
    # --- Basic Arithmetic ---
    {
        "category": "Arithmetic",
        "input": "Let me calculate 17 + 28 to find the total.",
        "output": "Let me calculate 17 + 28 [=45] to find the total.",
        "computations": 1,
    },
    {
        "category": "Arithmetic",
        "input": "First, 15 * 4 = 60. Then 60 / 3 gives us the answer.",
        "output": "First, 15 * 4 [=60] = 60. Then 60 / 3 [=20] gives us the answer.",
        "computations": 2,
    },
    # --- Word Problems (natural language math) ---
    {
        "category": "Word Problems",
        "input": "She has twice 7 apples in her basket.",
        "output": "She has twice 7 [=14] apples in her basket.",
        "computations": 1,
    },
    {
        "category": "Word Problems",
        "input": "Take half of 100 dollars for the deposit.",
        "output": "Take half of 100 [=50] dollars for the deposit.",
        "computations": 1,
    },
    {
        "category": "Word Problems",
        "input": "The sum of 10 and 25 gives us the total count.",
        "output": "The sum of 10 and 25 [=35] gives us the total count.",
        "computations": 1,
    },
    {
        "category": "Word Problems",
        "input": "Find the difference of 50 and 30 for the remaining amount.",
        "output": "Find the difference of 50 and 30 [=20] for the remaining amount.",
        "computations": 1,
    },
    {
        "category": "Word Problems",
        "input": "The product of 6 and 7 is the area.",
        "output": "The product of 6 and 7 [=42] is the area.",
        "computations": 1,
    },
    {
        "category": "Word Problems",
        "input": "We need double 25 items for the event.",
        "output": "We need double 25 [=50] items for the event.",
        "computations": 1,
    },
    {
        "category": "Word Problems",
        "input": "Take one third of 90 for each person.",
        "output": "Take one third of 90 [=30] for each person.",
        "computations": 1,
    },
    {
        "category": "Word Problems",
        "input": "A quarter of 80 students passed.",
        "output": "A quarter of 80 [=20] students passed.",
        "computations": 1,
    },
    # --- Square Roots ---
    {
        "category": "Square Roots",
        "input": "The hypotenuse is sqrt(9 + 16) = sqrt(25).",
        "output": "The hypotenuse is sqrt(9 + 16 [=25]) = sqrt(25) [=5].",
        "computations": 2,
    },
    # --- Factorial ---
    {
        "category": "Factorial",
        "input": "We need 5! permutations for this problem.",
        "output": "We need 5! [=120] permutations for this problem.",
        "computations": 1,
    },
    # --- Percentage ---
    {
        "category": "Percentage",
        "input": "What is 25% of 80? That would be the discount.",
        "output": "What is 25% of 80 [=20]? That would be the discount.",
        "computations": 1,
    },
    # --- Edge case: complex sentence structure not matched ---
    {
        "category": "Not Injected (complex structure)",
        "input": "If Alice has twice as many apples as Bob, and Bob has 7 apples.",
        "output": "If Alice has twice as many apples as Bob, and Bob has 7 apples.",
        "computations": 0,
        "note": "Indirect references ('twice as many as X') require multi-step reasoning",
    },
]

# =============================================================================
# DIRECT SOLVE EXAMPLES - tryLocalCompute() returns immediate answers
# =============================================================================

DIRECT_SOLVE_EXAMPLES = [
    # Query -> (result, method, time_ms)
    # Arithmetic
    ("17 + 28", 45, "arithmetic", 0.20),
    ("What is 15 * 4?", 60, "arithmetic", 0.03),
    ("2^10", 1024, "power", 0.02),
    # Word problems - multiplication
    ("twice 7", 14, "word_twice", 0.02),
    ("double 25", 50, "word_double", 0.02),
    ("triple 10", 30, "word_triple", 0.02),
    # Word problems - division
    ("half of 100", 50, "word_half", 0.02),
    ("one third of 90", 30, "word_fraction", 0.02),
    ("a quarter of 80", 20, "word_fraction", 0.02),
    # Word problems - operations
    ("sum of 10 and 25", 35, "word_sum", 0.02),
    ("difference of 50 and 30", 20, "word_difference", 0.02),
    ("product of 6 and 7", 42, "word_product", 0.02),
    # Functions
    ("sqrt(144)", 12, "square_root", 0.04),
    ("5!", 120, "factorial", 0.03),
    ("gcd(48, 18)", 6, "gcd", 0.03),
    ("lcm(4, 6)", 12, "lcm", 0.03),
    # Other
    ("Is 17 prime?", True, "primality", 0.02),
    ("25% of 80", 20, "percentage", 0.02),
]

# =============================================================================
# DOMAIN FILTERING EXAMPLES - Context-aware injection
# =============================================================================

DOMAIN_EXAMPLES = [
    {
        "system_prompt": "You are a math tutor helping students.",
        "thought": "The derivative of x^2 is 2x.",
        "domain": "educational",
        "filtered": 0,
        "note": "Calculus terms kept in educational context",
    },
    {
        "system_prompt": "You are a financial advisor.",
        "thought": "The derivative exposure on this bond is concerning.",
        "domain": "financial",
        "filtered": 0,
        "note": "No calculus injection - 'derivative' is a financial term here",
    },
    {
        "system_prompt": "You are a helpful assistant.",
        "thought": "To find the area, calculate 15 * 20 = 300 square feet.",
        "output": "To find the area, calculate 15 * 20 [=300] = 300 square feet.",
        "domain": "general",
        "filtered": 0,
    },
]


def print_header(title: str) -> None:
    """Print a section header."""
    width = 70
    print("\n" + "=" * width)
    print(f"  {title}")
    print("=" * width)


def print_subheader(title: str) -> None:
    """Print a subsection header."""
    print(f"\n--- {title} ---")


def show_architecture() -> None:
    """Display the local compute architecture."""
    print("""
┌─────────────────────────────────────────────────────────────────────┐
│              Verifiable Thinking - Local Compute Flow               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   User Query                                                        │
│       │                                                             │
│       ▼                                                             │
│   ┌───────────────┐     ┌────────────────┐     ┌────────────────┐  │
│   │  Classifier   │────▶│ Solver Registry│────▶│   Injection    │  │
│   │  (bitmask)    │     │  (by type)     │     │  [=result]     │  │
│   └───────────────┘     └────────────────┘     └────────────────┘  │
│         │                      │                      │            │
│         │               Solver Types:                 │            │
│         │               • arithmetic                  │            │
│         │               • square_root                 ▼            │
│         │               • factorial              Augmented         │
│         │               • fibonacci               Prompt           │
│         │               • percentage                               │
│         │               • word_twice/half/sum                      │
│         │               • gcd/lcm                                  │
│         │               • primality                                │
│         │               • power                                    │
│         │                                                          │
│         ▼                                                          │
│   LRU Cache (avoids recomputation)                                 │
│                                                                     │
│   Performance: ~0.02ms per computation (vs ~500ms LLM)             │
│   Accuracy: 100% on supported operations                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
""")


def show_injection_examples() -> None:
    """Show real prompt injection examples."""
    print_header("Prompt Injection Examples")
    print("\nThe extractAndCompute() function finds expressions and injects results:")

    current_category = None
    for ex in INJECTION_EXAMPLES:
        if ex["category"] != current_category:
            current_category = ex["category"]
            print_subheader(current_category)

        print(f'\n  Input:  "{ex["input"]}"')
        print(f'  Output: "{ex["output"]}"')
        print(f"  Computations: {ex['computations']}")
        if "note" in ex:
            print(f"  Note: {ex['note']}")


def show_direct_solve_examples() -> None:
    """Show tryLocalCompute() direct solving examples."""
    print_header("Direct Solve Examples")
    print("\nThe tryLocalCompute() function solves queries directly without LLM:")

    print(f"\n  {'Query':<25} {'Result':<12} {'Method':<15} {'Time':<10}")
    print(f"  {'-' * 25} {'-' * 12} {'-' * 15} {'-' * 10}")

    for query, result, method, time_ms in DIRECT_SOLVE_EXAMPLES:
        result_str = str(result)
        print(f"  {query:<25} {result_str:<12} {method:<15} {time_ms:.2f}ms")


def show_domain_filtering() -> None:
    """Show context-aware domain filtering."""
    print_header("Domain-Aware Filtering")
    print("\nThe contextAwareCompute() filters injections by domain relevance:")

    for ex in DOMAIN_EXAMPLES:
        print(f'\n  System: "{ex["system_prompt"]}"')
        print(f'  Thought: "{ex["thought"]}"')
        if "output" in ex:
            print(f'  Output: "{ex["output"]}"')
        print(f"  Domain: {ex['domain']}")
        print(f"  Filtered: {ex['filtered']} computations")
        if "note" in ex:
            print(f"  Note: {ex['note']}")


def show_typescript_usage() -> None:
    """Show TypeScript usage examples."""
    print_header("TypeScript Usage")
    print("""
// Direct solve - returns result immediately if computable
import { tryLocalCompute } from './src/compute';

const result = tryLocalCompute("What is 17 + 28?");
// => { solved: true, result: 45, method: "arithmetic", confidence: 1, time_ms: 0.2 }

// Prompt injection - augments text with computed values
import { extractAndCompute } from './src/compute';

const augmented = extractAndCompute("Calculate 15 * 4 for the area.");
// => { augmented: "Calculate 15 * 4 [=60] for the area.", computations: [...] }

// Context-aware - filters by domain relevance  
import { contextAwareCompute } from './src/compute';

const result = contextAwareCompute({
  systemPrompt: "You are a financial advisor.",
  thought: "The derivative exposure is high.",
});
// => No calculus injection (derivative = financial term in context)

// Simple API - just returns augmented string
import { computeWithContext } from './src/compute';

const text = computeWithContext(
  "What is 5! ways to arrange?",  // thought
  "You are a math tutor."          // optional system prompt
);
// => "What is 5! [=120] ways to arrange?"
""")


def main() -> None:
    """Main entry point."""
    print("\n" + "=" * 70)
    print("       VERIFIABLE THINKING - LOCAL COMPUTE DEMONSTRATION")
    print("=" * 70)

    show_architecture()
    show_injection_examples()
    show_direct_solve_examples()
    show_domain_filtering()
    show_typescript_usage()

    print_header("Test It Yourself")
    print("""
# Run the actual TypeScript implementation:
cd /path/to/verifiable_thinking

# Test direct solve
bun -e "
import { tryLocalCompute } from './src/compute';
console.log(tryLocalCompute('sqrt(144)'));
"

# Test injection
bun -e "
import { extractAndCompute } from './src/compute';
console.log(extractAndCompute('First calculate 8 * 7 = 56, then add 4.'));
"

# Start the MCP server
bun run src/index.ts
""")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    main()
