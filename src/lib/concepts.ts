/**
 * Concept Tracker - Lightweight concept extraction and tracking
 * Simplified from full ConceptWeb (no graph metrics for speed)
 */

export interface Concept {
  id: string;
  name: string;
  domain: "math" | "logic" | "code" | "language" | "general";
  first_seen_step: number;
  count: number;
}

// Domain-specific keyword patterns
const DOMAIN_KEYWORDS: Record<Concept["domain"], RegExp> = {
  math: /\b(equation|variable|function|derivative|integral|sum|product|matrix|vector|polynomial|coefficient|algebra|calculus|theorem|proof|solve|calculate|compute)\b/gi,
  logic: /\b(therefore|implies|if|then|because|hence|thus|conclude|assume|given|premise|proposition|valid|invalid|fallacy|deduction|induction|axiom)\b/gi,
  code: /\b(function|class|method|variable|loop|array|object|string|boolean|integer|algorithm|complexity|runtime|memory|pointer|reference|async|await|promise|callback)\b/gi,
  language: /\b(syntax|grammar|semantic|parse|token|lexer|compiler|interpreter|expression|statement|declaration)\b/gi,
  general: /\b(problem|solution|step|approach|strategy|method|technique|process|result|outcome|goal|objective)\b/gi,
};

export class ConceptTracker {
  private concepts: Map<string, Concept> = new Map();

  extract(thought: string, stepNumber: number): Concept[] {
    const extracted: Concept[] = [];
    const seen = new Set<string>();

    for (const [domain, pattern] of Object.entries(DOMAIN_KEYWORDS)) {
      const matches = thought.match(pattern) || [];
      
      for (const match of matches) {
        const name = match.toLowerCase();
        if (seen.has(name)) continue;
        seen.add(name);

        const id = `${domain}:${name}`;
        const existing = this.concepts.get(id);

        if (existing) {
          existing.count++;
        } else {
          const concept: Concept = {
            id,
            name,
            domain: domain as Concept["domain"],
            first_seen_step: stepNumber,
            count: 1,
          };
          this.concepts.set(id, concept);
          extracted.push(concept);
        }
      }
    }

    return extracted;
  }

  getAll(): Concept[] {
    return Array.from(this.concepts.values());
  }

  getByDomain(domain: Concept["domain"]): Concept[] {
    return this.getAll().filter(c => c.domain === domain);
  }

  getTopConcepts(n: number = 5): Concept[] {
    return this.getAll()
      .sort((a, b) => b.count - a.count)
      .slice(0, n);
  }

  getSummary(): { total: number; by_domain: Record<string, number>; top: string[] } {
    const all = this.getAll();
    const byDomain: Record<string, number> = {};
    
    for (const c of all) {
      byDomain[c.domain] = (byDomain[c.domain] || 0) + 1;
    }

    return {
      total: all.length,
      by_domain: byDomain,
      top: this.getTopConcepts(5).map(c => c.name),
    };
  }

  clear(): void {
    this.concepts.clear();
  }
}

// Per-session concept trackers
const trackers: Map<string, ConceptTracker> = new Map();

export function getTracker(sessionId: string): ConceptTracker {
  let tracker = trackers.get(sessionId);
  if (!tracker) {
    tracker = new ConceptTracker();
    trackers.set(sessionId, tracker);
  }
  return tracker;
}

export function clearTracker(sessionId: string): void {
  trackers.delete(sessionId);
}
