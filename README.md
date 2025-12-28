# Verifiable Thinking MCP

A Model Context Protocol (MCP) server for structured reasoning with verification, concept tracking, and context compression.

## Features

- **Domain-specific verification** - Math, logic, code, general domains
- **CPC-style compression** - Sentence-level context compression (up to 10x faster than token-level)
- **Concept tracking** - Extract and track concepts across reasoning chains
- **Session management** - Multi-turn reasoning with TTL cleanup
- **Self-correction detection** - Blind spot detection with "Wait" marker (89.3% effectiveness)
- **Branching** - Explore alternative reasoning paths

## Setup

```bash
bun install
```

## Development

```bash
# Interactive dev mode with MCP Inspector
bun run dev

# Inspect server capabilities
bun run inspect

# Run directly
bun run start
```

## Tools

### `think`
Record a structured reasoning step with optional verification and compression.

```json
{
  "thought": "To solve 2x + 5 = 13, subtract 5 from both sides: 2x = 8",
  "step_number": 1,
  "total_steps": 3,
  "verify": true,
  "domain": "math",
  "track_concepts": true,
  "session_id": "algebra-problem"
}
```

**Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `thought` | string | required | Current reasoning step |
| `step_number` | number | required | Step number (≥1) |
| `total_steps` | number | required | Estimated total steps |
| `verify` | boolean | false | Enable domain verification |
| `domain` | enum | "general" | math, logic, code, general |
| `compress_context` | boolean | false | CPC-style compression |
| `compression_ratio` | number | 0.5 | Target ratio (0.1-1.0) |
| `track_concepts` | boolean | false | Extract concepts |
| `branch_id` | string | "main" | Branch identifier |
| `check_blindspot` | boolean | false | Self-correction detection |
| `session_id` | string | auto | Session identifier |

### `list_sessions`
List all active reasoning sessions.

### `get_session`
Retrieve a session in full, summary, or compressed format.

### `clear_session`
Clear a specific session or all sessions.

### `compress`
Standalone CPC-style context compression tool.

```json
{
  "context": "Your long text or context to compress...",
  "query": "focus query for relevance scoring",
  "target_ratio": 0.5,
  "boost_reasoning": true
}
```

**Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `context` | string | required | Text to compress |
| `query` | string | required | Focus query for relevance |
| `target_ratio` | number | 0.5 | Target ratio (0.1-1.0) |
| `max_tokens` | number | - | Alternative: max tokens to keep |
| `boost_reasoning` | boolean | true | Boost reasoning keywords |

## Architecture

```
src/
├── index.ts              # FastMCP server entry
├── tools/
│   ├── think.ts          # Main reasoning tool
│   ├── sessions.ts       # Session management
│   └── compress.ts       # Standalone compression tool
└── lib/
    ├── verification.ts   # Domain verifiers (<10ms overhead)
    ├── compression.ts    # CPC-style sentence compression
    ├── concepts.ts       # Concept extraction
    ├── cache.ts          # Verification result caching
    └── session.ts        # Session manager with TTL
```

## Research Basis

Based on 2024-2025 research papers:

1. **RLVR** (arXiv:2506.14245) - Binary verification rewards
2. **Self-Correction Bench** (arXiv:2507.02778) - "Wait" marker reduces blind spots 89.3%
3. **CPC** (arXiv:2409.01227) - Context-aware prompt compression, 10.93x faster

## Example Usage

```typescript
// Step 1: Start reasoning
await think({
  thought: "Given f(x) = x² + 2x, find f'(x) using power rule",
  step_number: 1,
  total_steps: 2,
  verify: true,
  domain: "math",
  session_id: "derivative-calc"
});

// Step 2: Complete
await think({
  thought: "Applying power rule: f'(x) = 2x + 2",
  step_number: 2,
  total_steps: 2,
  verify: true,
  domain: "math",
  is_final: true,
  session_id: "derivative-calc"
});

// Review session
await get_session({ session_id: "derivative-calc", format: "summary" });
```

## Configuration

For Claude Desktop, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "verifiable-thinking": {
      "command": "npx",
      "args": ["-y", "verifiable-thinking-mcp"]
    }
  }
}
```
