/**
 * Simple LLM client for benchmarks.
 * Minimal httpx-style client with rate limiting and retry logic.
 */

// Global rate limiting state
let llmSemaphore: { acquire: () => Promise<() => void> } | null = null;
let lastRequestTime = 0;

const LLM_CONCURRENCY = parseInt(process.env.LLM_CONCURRENCY || "2", 10);
const LLM_DELAY = parseFloat(process.env.LLM_DELAY || "1.0") * 1000; // Convert to ms

export interface LLMConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeout: number;
  maxTokens: number;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatResponse {
  choices: Array<{
    message: {
      content?: string;
      reasoning_content?: string;
      reasoning?: string;
    };
    delta?: {
      content?: string;
      reasoning_content?: string;
    };
  }>;
}

/**
 * Simple semaphore for concurrency limiting
 */
function createSemaphore(limit: number) {
  let running = 0;
  const queue: Array<() => void> = [];

  return {
    async acquire(): Promise<() => void> {
      if (running < limit) {
        running++;
        return () => {
          running--;
          if (queue.length > 0) {
            const next = queue.shift();
            if (next) {
              running++;
              next();
            }
          }
        };
      }

      return new Promise((resolve) => {
        queue.push(() => {
          resolve(() => {
            running--;
            if (queue.length > 0) {
              const next = queue.shift();
              if (next) {
                running++;
                next();
              }
            }
          });
        });
      });
    },
  };
}

function getSemaphore() {
  if (!llmSemaphore) {
    llmSemaphore = createSemaphore(LLM_CONCURRENCY);
  }
  return llmSemaphore;
}

/**
 * Minimal LLM client - just fetch, no magic.
 */
export class LLMClient {
  private config: LLMConfig;

  constructor(config: Partial<LLMConfig> = {}) {
    this.config = {
      baseUrl: config.baseUrl || process.env.LLM_BASE_URL || "https://api.z.ai/api/coding/paas/v4",
      model: config.model || process.env.LLM_MODEL || "glm-4.7",
      apiKey: config.apiKey || process.env.LLM_API_KEY || "",
      timeout: config.timeout || parseInt(process.env.LLM_TIMEOUT || "120000", 10),
      maxTokens: config.maxTokens || parseInt(process.env.LLM_MAX_TOKENS || "4096", 10),
    };
  }

  /**
   * Ask LLM a question. Returns response text.
   * Uses semaphore to limit concurrent requests and prevent rate limiting.
   */
  async ask(
    prompt: string,
    options: { system?: string; temperature?: number } = {}
  ): Promise<string> {
    const { system, temperature = 0.1 } = options;
    const messages: ChatMessage[] = [];

    if (system) {
      messages.push({ role: "system", content: system });
    }
    messages.push({ role: "user", content: prompt });

    const semaphore = getSemaphore();

    for (let attempt = 0; attempt < 3; attempt++) {
      const release = await semaphore.acquire();

      try {
        // Rate limiting: ensure minimum delay between requests
        const now = Date.now();
        const elapsed = now - lastRequestTime;
        if (elapsed < LLM_DELAY) {
          await Bun.sleep(LLM_DELAY - elapsed);
        }
        lastRequestTime = Date.now();

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        try {
          const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.config.apiKey}`,
            },
            body: JSON.stringify({
              model: this.config.model,
              messages,
              max_tokens: this.config.maxTokens,
              temperature,
            }),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (response.status === 429 && attempt < 2) {
            const waitTime = 30_000 * (attempt + 1);
            console.log(`  [rate limit] Waiting ${waitTime / 1000}s before retry...`);
            await Bun.sleep(waitTime);
            continue;
          }

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
          }

          const data = (await response.json()) as ChatResponse;
          const msg = data.choices[0]?.message;
          if (!msg) return "";

          const content = msg.content || "";
          const reasoning = msg.reasoning_content || msg.reasoning || "";

          return content.trim() ? content : reasoning;
        } finally {
          clearTimeout(timeoutId);
        }
      } finally {
        release();
      }
    }

    return "";
  }

  /**
   * Stream LLM response, yielding chunks as they arrive.
   */
  async *stream(
    prompt: string,
    options: { system?: string; temperature?: number } = {}
  ): AsyncGenerator<string> {
    const { system, temperature = 0.1 } = options;
    const messages: ChatMessage[] = [];

    if (system) {
      messages.push({ role: "system", content: system });
    }
    messages.push({ role: "user", content: prompt });

    const semaphore = getSemaphore();
    const release = await semaphore.acquire();

    try {
      // Rate limiting
      const now = Date.now();
      const elapsed = now - lastRequestTime;
      if (elapsed < LLM_DELAY) {
        await Bun.sleep(LLM_DELAY - elapsed);
      }
      lastRequestTime = Date.now();

      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          max_tokens: this.config.maxTokens,
          temperature,
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;

          const data = line.slice(6);
          if (data === "[DONE]") return;

          try {
            const chunk = JSON.parse(data) as ChatResponse;
            const delta = chunk.choices[0]?.delta;
            const text = delta?.content || delta?.reasoning_content || "";
            if (text) yield text;
          } catch {
            // Ignore parse errors
          }
        }
      }
    } finally {
      release();
    }
  }
}

// Export singleton for simple usage
export const llm = new LLMClient();
