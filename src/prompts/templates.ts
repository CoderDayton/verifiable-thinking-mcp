/**
 * Pre-built reasoning prompts/templates for common use cases
 * Guides LLMs on how to use the think tool effectively
 */

export interface ReasoningTemplate {
  name: string;
  description: string;
  domain: "math" | "logic" | "code" | "general";
  suggested_steps: number;
  system_prompt: string;
}

export const templates: Record<string, ReasoningTemplate> = {
  "mathematical-proof": {
    name: "Mathematical Proof",
    description: "Step-by-step mathematical derivation with verification",
    domain: "math",
    suggested_steps: 5,
    system_prompt: `You are solving a mathematical problem step by step.
For each step:
1. State the operation or theorem being applied
2. Show the transformation clearly
3. Use verify=true to check arithmetic and algebraic validity
4. Use operation="complete" with final_answer= to finalize`,
  },

  "logical-deduction": {
    name: "Logical Deduction",
    description: "Formal logical reasoning with premise validation",
    domain: "logic",
    suggested_steps: 4,
    system_prompt: `You are performing logical deduction.
For each step:
1. State premises explicitly
2. Apply one inference rule per step (modus ponens, modus tollens, etc.)
3. Use verify=true to check logical consistency

Avoid introducing new premises without justification.`,
  },

  "code-review": {
    name: "Code Review",
    description: "Systematic code analysis for bugs and improvements",
    domain: "code",
    suggested_steps: 6,
    system_prompt: `You are reviewing code for correctness and quality.
For each step:
1. Focus on one aspect: syntax, logic, edge cases, performance, security
2. Quote specific code when identifying issues
3. Use verify=true to check assertions about code behavior
4. Use compress=true for large files (default: on)

Categories to check: null handling, off-by-one errors, resource leaks, error handling, type safety.`,
  },

  debugging: {
    name: "Debugging",
    description: "Systematic bug investigation with hypothesis testing",
    domain: "code",
    suggested_steps: 5,
    system_prompt: `You are debugging a reported issue.
For each step:
1. Form a hypothesis about the bug cause
2. Identify evidence that supports or refutes it
3. Use branching (branch_id) to explore multiple hypotheses in parallel
4. Use verify=true to validate assumptions about code behavior

Structure: Symptom → Hypothesis → Evidence → Conclusion → Fix`,
  },

  "problem-decomposition": {
    name: "Problem Decomposition",
    description: "Breaking complex problems into manageable sub-problems",
    domain: "general",
    suggested_steps: 4,
    system_prompt: `You are decomposing a complex problem.
For each step:
1. Identify the core question or goal
2. Break into independent sub-problems where possible
3. Note dependencies between sub-problems
4. Track key concepts/variables across steps

Aim for sub-problems that can be solved independently and combined.`,
  },

  "comparative-analysis": {
    name: "Comparative Analysis",
    description: "Systematic comparison of alternatives with trade-offs",
    domain: "general",
    suggested_steps: 5,
    system_prompt: `You are comparing multiple options or approaches.
For each step:
1. Define evaluation criteria first
2. Analyze each option against criteria
3. Use operation="branch" to evaluate options in parallel
4. Synthesize findings with weighted trade-offs

Avoid bias: evaluate all options with same criteria before concluding.`,
  },
};

// Prompts for FastMCP - using 'as const' for proper type inference
export const mathematicalProofPrompt = {
  name: "mathematical-proof",
  description: "Guide for step-by-step mathematical proofs with verification",
  arguments: [
    {
      name: "problem",
      description: "The mathematical problem to solve",
      required: true,
    },
  ] as const,
  load: async (args: { problem?: string }) => {
    const template = templates["mathematical-proof"]!;
    return {
      messages: [
        {
          role: "system" as const,
          content: {
            type: "text" as const,
            text: template.system_prompt,
          },
        },
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Problem: ${args.problem || "Not specified"}\n\nUse the 'scratchpad' tool with domain="math" and verify=true for each step.`,
          },
        },
      ],
    };
  },
};

export const logicalDeductionPrompt = {
  name: "logical-deduction",
  description: "Guide for formal logical reasoning with premise validation",
  arguments: [
    {
      name: "premises",
      description: "The premises to reason from",
      required: true,
    },
    {
      name: "conclusion",
      description: "The conclusion to prove (optional)",
      required: false,
    },
  ] as const,
  load: async (args: { premises?: string; conclusion?: string }) => {
    const template = templates["logical-deduction"]!;
    const goal = args.conclusion ? `Prove: ${args.conclusion}` : "Derive valid conclusions";
    return {
      messages: [
        {
          role: "system" as const,
          content: {
            type: "text" as const,
            text: template.system_prompt,
          },
        },
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Premises:\n${args.premises || "Not specified"}\n\n${goal}\n\nUse the 'scratchpad' tool with domain="logic" and verify=true.`,
          },
        },
      ],
    };
  },
};

export const codeReviewPrompt = {
  name: "code-review",
  description: "Guide for systematic code review",
  arguments: [
    {
      name: "code",
      description: "The code to review",
      required: true,
    },
    {
      name: "focus",
      description: "Specific focus areas (e.g., security, performance)",
      required: false,
    },
  ] as const,
  load: async (args: { code?: string; focus?: string }) => {
    const template = templates["code-review"]!;
    const focusNote = args.focus ? `Focus on: ${args.focus}` : "";
    return {
      messages: [
        {
          role: "system" as const,
          content: {
            type: "text" as const,
            text: template.system_prompt,
          },
        },
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Review this code:\n\`\`\`\n${args.code || "No code provided"}\n\`\`\`\n${focusNote}\n\nUse the 'scratchpad' tool with domain="code" and verify=true.`,
          },
        },
      ],
    };
  },
};

export const debuggingPrompt = {
  name: "debugging",
  description: "Guide for systematic bug investigation",
  arguments: [
    {
      name: "symptom",
      description: "The bug symptom or error message",
      required: true,
    },
    {
      name: "context",
      description: "Relevant code or context",
      required: false,
    },
  ] as const,
  load: async (args: { symptom?: string; context?: string }) => {
    const template = templates.debugging!;
    const contextNote = args.context ? `\nContext:\n${args.context}` : "";
    return {
      messages: [
        {
          role: "system" as const,
          content: {
            type: "text" as const,
            text: template.system_prompt,
          },
        },
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Bug symptom: ${args.symptom || "Not specified"}${contextNote}\n\nUse the 'scratchpad' tool with domain="code" to investigate.`,
          },
        },
      ],
    };
  },
};

export const problemDecompositionPrompt = {
  name: "problem-decomposition",
  description: "Guide for breaking complex problems into sub-problems",
  arguments: [
    {
      name: "problem",
      description: "The complex problem to decompose",
      required: true,
    },
  ] as const,
  load: async (args: { problem?: string }) => {
    const template = templates["problem-decomposition"]!;
    return {
      messages: [
        {
          role: "system" as const,
          content: {
            type: "text" as const,
            text: template.system_prompt,
          },
        },
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Problem: ${args.problem || "Not specified"}\n\nUse the 'scratchpad' tool to decompose step by step.`,
          },
        },
      ],
    };
  },
};

export const comparativeAnalysisPrompt = {
  name: "comparative-analysis",
  description: "Guide for comparing alternatives with trade-offs",
  arguments: [
    {
      name: "options",
      description: "The options to compare",
      required: true,
    },
    {
      name: "criteria",
      description: "Evaluation criteria (optional)",
      required: false,
    },
  ] as const,
  load: async (args: { options?: string; criteria?: string }) => {
    const template = templates["comparative-analysis"]!;
    const criteriaNote = args.criteria ? `\nCriteria: ${args.criteria}` : "";
    return {
      messages: [
        {
          role: "system" as const,
          content: {
            type: "text" as const,
            text: template.system_prompt,
          },
        },
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Compare these options: ${args.options || "Not specified"}${criteriaNote}\n\nUse the 'scratchpad' tool with operation="branch" to evaluate each option.`,
          },
        },
      ],
    };
  },
};

// Export all prompts for registration
export const allPrompts = [
  mathematicalProofPrompt,
  logicalDeductionPrompt,
  codeReviewPrompt,
  debuggingPrompt,
  problemDecompositionPrompt,
  comparativeAnalysisPrompt,
];
