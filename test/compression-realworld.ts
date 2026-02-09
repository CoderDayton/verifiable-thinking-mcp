import { compress } from "../src/lib/compression";
import { estimateTokensFast } from "../src/lib/tokens-fast";

// Test case 1: Coding problem thinking
const codingThinking = `Okay so I need to implement fibonacci with memoization. Let me think about this step by step.

First, let me understand what we're trying to do here. Fibonacci sequence is where each number is the sum of the two preceding ones, right? So it goes 0, 1, 1, 2, 3, 5, 8, 13, and so on. The naive recursive approach would be something like:

\`\`\`typescript
function fib(n: number): number {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}
\`\`\`

But wait, that's not efficient at all. This has exponential time complexity O(2^n) because we're recalculating the same values over and over again. Like if we call fib(5), it calls fib(4) and fib(3), and fib(4) also calls fib(3), so we're computing fib(3) twice. And it gets way worse as n grows larger.

Hmm, let me think about memoization. The idea is to cache the results so we don't recompute them. We can use a Map or an object to store previously calculated values. Let me try this:

\`\`\`typescript
function fibMemo(n: number, memo: Map<number, number> = new Map()): number {
  if (n <= 1) return n;
  if (memo.has(n)) return memo.get(n)!;
  
  const result = fibMemo(n - 1, memo) + fibMemo(n - 2, memo);
  memo.set(n, result);
  return result;
}
\`\`\`

Wait, that's not quite right. I'm creating a new Map on each call if one isn't provided, but then passing it down. Actually, that should work fine. The default parameter only gets evaluated once per call chain. Let me verify this logic in my head.

When we call fibMemo(5), it checks if 5 <= 1 (no), checks if memo has 5 (no initially), then recursively calls fibMemo(4, memo) and fibMemo(3, memo). The memo is shared across all these calls, so when fibMemo(4) eventually calls fibMemo(3), and then later the original call also needs fibMemo(3), the second time it will already be in the memo. Yeah, that makes sense.

The time complexity is now O(n) because we compute each fibonacci number exactly once, and the space complexity is also O(n) for the memoization cache plus O(n) for the call stack depth. Actually, we could improve this further with an iterative approach to avoid the call stack overhead, but memoization is what was asked for.

Let me think about edge cases. What if n is negative? The current implementation would cause infinite recursion because we'd keep subtracting and never hit the base case. We should add a check:

\`\`\`typescript
function fibMemo(n: number, memo: Map<number, number> = new Map()): number {
  if (n < 0) throw new Error('n must be non-negative');
  if (n <= 1) return n;
  if (memo.has(n)) return memo.get(n)!;
  
  const result = fibMemo(n - 1, memo) + fibMemo(n - 2, memo);
  memo.set(n, result);
  return result;
}
\`\`\`

Okay, I think that's a solid implementation. Let me just double-check the logic one more time. Base cases: n < 0 throws error, n = 0 returns 0, n = 1 returns 1. Recursive case: check memo first, if not found compute it recursively and store it. Yep, looks good to me.`;

const mathThinking = `Alright, let me work through this probability problem carefully. The question is asking about drawing cards from a standard deck. Let me restate it to make sure I understand: we have a standard 52-card deck, and we want to find the probability of drawing at least one ace in two draws without replacement.

Hmm, okay so there are 4 aces in a deck of 52 cards. When we draw without replacement, the first draw affects the second draw. Let me think about how to approach this.

I could calculate this directly by finding P(at least one ace), but actually it might be easier to use the complement. P(at least one ace) = 1 - P(no aces). Let me try that approach.

The probability of not drawing an ace on the first draw is 48/52, because there are 48 non-ace cards out of 52 total cards. Wait, let me verify that. 52 total cards minus 4 aces equals 48 non-aces. Yes, that's right.

Now, if we didn't draw an ace on the first draw, then for the second draw we have 51 cards left, and still 4 aces (since we didn't draw one), so there are 47 non-aces left. So P(no ace on second draw | no ace on first draw) = 47/51.

Therefore, P(no aces in two draws) = (48/52) × (47/51). Let me calculate this step by step.

48/52 simplifies to 12/13. And 47/51... hmm, I don't think that simplifies nicely. Let me just compute it directly:

(48 × 47) / (52 × 51) = 2256 / 2652

Can this be simplified? Let me find the GCD. 2256 = 16 × 141, and 2652 = 4 × 663. Hmm, so they both divide by 4:

2256 / 4 = 564
2652 / 4 = 663

Do 564 and 663 share any common factors? 564 = 4 × 141, and 663 = 3 × 221. They don't share factors, so 564/663 is the simplified form.

Wait, let me double-check my arithmetic. 48 × 47 = 2256. Let me verify: 48 × 40 = 1920, and 48 × 7 = 336, so 1920 + 336 = 2256. Good.

52 × 51 = 2652. Let me verify: 52 × 50 = 2600, and 52 × 1 = 52, so 2600 + 52 = 2652. Good.

So P(no aces) = 564/663. Therefore, P(at least one ace) = 1 - 564/663 = (663 - 564)/663 = 99/663.

Let me simplify 99/663. Both are divisible by 9. 99/9 = 11, and 663/9 = 73.7... wait, that's not an integer. Let me recalculate. 9 × 73 = 657, not 663. So they're not both divisible by 9.

Actually, let me try 3. 99/3 = 33, and 663/3 = 221. So we get 33/221. Can this simplify further? 33 = 3 × 11, and 221 = 13 × 17. They don't share factors.

So the final answer is 33/221, or approximately 0.149 or about 14.9%.

Let me just verify this makes intuitive sense. The probability of drawing an ace on a single draw is 4/52 ≈ 7.7%. With two draws, we'd expect roughly double that if the events were independent, so around 15%. Our answer of 14.9% is very close to that, which makes sense. The events aren't quite independent, but close enough for a rough check.`;

const architectureThinking = `Let me analyze the microservices versus monolith architecture decision. This is a complex topic with many considerations, so I'll try to think through the various tradeoffs systematically.

First of all, it's worth noting that both approaches have their merits, and the right choice really depends on the specific context of the project. Generally speaking, there's no one-size-fits-all answer here.

Starting with monolithic architecture, the main advantage is simplicity. When you have all your code in a single codebase and deploy it as a single unit, things are straightforward. You don't have to worry about network boundaries, service discovery, distributed transactions, or any of that complexity. For small to medium-sized teams, this can be a huge benefit due to the fact that you can move faster without dealing with all that overhead.

Additionally, with a monolith, testing is generally easier. You can run integration tests locally without having to spin up multiple services. Debugging is also more straightforward because you can step through the entire flow in a single debugger session. The development experience tends to be smoother in order to avoid the complexities of running multiple services locally.

However, monoliths have their downsides. As the codebase grows, it can become difficult to maintain. Different parts of the application are tightly coupled, so changing one thing might break something else in an unexpected way. It's worth mentioning that this coupling can slow down development over time as the system becomes more complex.

Deployment is another challenge with monoliths. You have to deploy the entire application even if you only changed one small part. This means longer deployment times and higher risk, because any bug in any part of the application can bring down the entire system.

Now, moving on to microservices architecture, the primary benefit is that it allows teams to work independently on different services. Each service can be developed, tested, and deployed separately. This is particularly valuable for large organizations with multiple teams. Due to the fact that services are decoupled, teams can move at their own pace without blocking each other.

Scalability is another advantage of microservices. You can scale individual services based on their specific needs rather than scaling the entire application. If one particular service is getting a lot of traffic, you can scale just that service. This can be more cost-effective and efficient.

Technology flexibility is also something to consider. With microservices, each service can potentially use a different technology stack. If a particular language or framework is better suited for a specific problem, you can use it for that service without affecting the others. Generally speaking, this flexibility can be valuable, though it also introduces complexity.

However, microservices come with significant challenges. The operational overhead is substantial. You need to manage service discovery, load balancing, monitoring, logging, and tracing across multiple services. The infrastructure complexity increases dramatically. It's worth noting that you'll likely need container orchestration platforms like Kubernetes, which have their own learning curves.

Distributed systems are inherently more complex than monolithic ones. Network calls can fail, so you need to handle retries, timeouts, and circuit breakers. Debugging becomes much harder when a request flows through multiple services. Due to the fact that services communicate over the network, latency can become an issue.

Data management is particularly tricky with microservices. Each service typically has its own database in order to maintain independence, but this makes it difficult to maintain consistency across services. You might need to implement distributed transactions or use eventual consistency patterns, which adds complexity.

In summary, I'd say that monoliths are generally better for smaller teams, simpler applications, or early-stage startups where speed of development is critical. Microservices make more sense for larger organizations with multiple teams, or for applications that need to scale different components independently. It's worth noting that many successful companies start with a monolith and gradually break it apart into services as they grow. This hybrid approach can offer the best of both worlds.`;

async function runBenchmark() {
  const testCases = [
    {
      name: "Coding Problem (Fibonacci DP)",
      text: codingThinking,
      query: "How to implement memoized fibonacci?",
    },
    {
      name: "Math/Logic (Probability)",
      text: mathThinking,
      query: "Calculate probability of drawing aces",
    },
    {
      name: "Architecture Analysis",
      text: architectureThinking,
      query: "Compare microservices vs monolith",
    },
  ];

  const results = [];

  console.log("=".repeat(80));
  console.log("REAL-WORLD COMPRESSION BENCHMARK");
  console.log("=".repeat(80));
  console.log();

  for (const { name, text, query } of testCases) {
    console.log(`\n${"─".repeat(80)}`);
    console.log(`TEST CASE: ${name}`);
    console.log("─".repeat(80));

    const originalTokens = estimateTokensFast(text);
    const originalLength = text.length;

    console.log(`\nOriginal: ${originalLength} chars, ~${originalTokens} tokens`);
    console.log(`Query: "${query}"`);

    const start = performance.now();
    const result = compress(text, query);
    const elapsed = performance.now() - start;

    const compressedTokens = estimateTokensFast(result.compressed);
    const ratio = ((1 - compressedTokens / originalTokens) * 100).toFixed(1);

    console.log(
      `\n--- COMPRESSED OUTPUT (${result.compressed.length} chars, ~${compressedTokens} tokens) ---`,
    );
    console.log(result.compressed);
    console.log(`\n--- METRICS ---`);
    console.log(`Latency: ${elapsed.toFixed(2)}ms`);
    console.log(`Compression ratio: ${ratio}% reduction`);
    console.log(`Kept sentences: ${result.kept_sentences}`);
    console.log(`Dropped sentences: ${result.dropped_sentences.length}`);
    if (result.enhancements) {
      console.log(`Enhancements:`);
      console.log(`  - Fillers removed: ${result.enhancements.fillers_removed}`);
      console.log(`  - Coref constraints: ${result.enhancements.coref_constraints_applied}`);
      console.log(`  - Causal constraints: ${result.enhancements.causal_constraints_applied}`);
      console.log(`  - Repetitions penalized: ${result.enhancements.repetitions_penalized}`);
    }

    results.push({
      name,
      originalLength,
      originalTokens,
      compressedLength: result.compressed.length,
      compressedTokens,
      ratio: parseFloat(ratio),
      dropped: result.dropped_sentences.length,
      latency: elapsed,
    });
  }

  console.log(`\n\n${"=".repeat(80)}`);
  console.log("SUMMARY TABLE");
  console.log("=".repeat(80));
  console.log();
  console.log(
    "Test Case".padEnd(35),
    "| Orig Tokens | Comp Tokens | Reduction | Dropped | Latency  |",
  );
  console.log(
    "-".repeat(35) +
      "|" +
      "-".repeat(13) +
      "|" +
      "-".repeat(13) +
      "|" +
      "-".repeat(11) +
      "|" +
      "-".repeat(9) +
      "|" +
      "-".repeat(10) +
      "|",
  );

  for (const r of results) {
    console.log(
      r.name.padEnd(35),
      "|",
      r.originalTokens.toString().padStart(11),
      "|",
      r.compressedTokens.toString().padStart(11),
      "|",
      `${r.ratio.toFixed(1)}%`.padStart(9),
      "|",
      r.dropped.toString().padStart(7),
      "|",
      `${r.latency.toFixed(1)}ms`.padStart(8),
      "|",
    );
  }

  const avgReduction = (results.reduce((sum, r) => sum + r.ratio, 0) / results.length).toFixed(1);
  console.log();
  console.log(`Average compression: ${avgReduction}% reduction`);
  console.log();
}

runBenchmark().catch(console.error);
