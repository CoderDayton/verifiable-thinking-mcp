/**
 * MCP Schema Compliance Tests
 *
 * Validates that all tool schemas conform to MCP SDK requirements:
 * - inputSchema.type MUST be "object" at root level
 * - No oneOf/anyOf/allOf at root (breaks MCP validation)
 *
 * These tests prevent regressions like using z.discriminatedUnion()
 * which produces JSON Schema with oneOf at root.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  clearSessionTool,
  compressTool,
  getSessionTool,
  listSessionsTool,
  scratchpadTool,
} from "../src/tools/index.ts";

// Define a proper type for JSON Schema output
interface JsonSchemaObject {
  type?: string;
  oneOf?: unknown[];
  anyOf?: unknown[];
  allOf?: unknown[];
  properties?: Record<string, unknown>;
  $schema?: string;
  definitions?: Record<string, unknown>;
}

// Helper to convert Zod schema to JSON Schema using Zod v4 native method
function toJsonSchema(schema: z.ZodType): JsonSchemaObject {
  return schema.toJSONSchema() as JsonSchemaObject;
}

// Collect all tools with their Zod schemas
const tools = [
  { name: "scratchpad", schema: scratchpadTool.parameters },
  { name: "list_sessions", schema: listSessionsTool.parameters },
  { name: "get_session", schema: getSessionTool.parameters },
  { name: "clear_session", schema: clearSessionTool.parameters },
  { name: "compress", schema: compressTool.parameters },
] as const;

describe("MCP Schema Compliance", () => {
  for (const { name, schema } of tools) {
    describe(`${name} tool`, () => {
      test('schema has type="object" at root', () => {
        const jsonSchema = toJsonSchema(schema);
        expect(jsonSchema.type).toBe("object");
      });

      test("schema has no oneOf at root level", () => {
        const jsonSchema = toJsonSchema(schema);
        expect(jsonSchema.oneOf).toBeUndefined();
      });

      test("schema has no anyOf at root level", () => {
        const jsonSchema = toJsonSchema(schema);
        expect(jsonSchema.anyOf).toBeUndefined();
      });

      test("schema has no allOf at root level", () => {
        const jsonSchema = toJsonSchema(schema);
        expect(jsonSchema.allOf).toBeUndefined();
      });

      test("schema has properties object", () => {
        const jsonSchema = toJsonSchema(schema);
        expect(jsonSchema.properties).toBeDefined();
        expect(typeof jsonSchema.properties).toBe("object");
      });
    });
  }

  // Specific test for scratchpad - the tool that previously failed
  describe("scratchpad specific checks", () => {
    test("operation field is a simple enum, not discriminated union", () => {
      const jsonSchema = toJsonSchema(scratchpadTool.parameters) as {
        properties?: {
          operation?: {
            type?: string;
            enum?: string[];
          };
        };
      };

      const operationSchema = jsonSchema.properties?.operation;
      expect(operationSchema).toBeDefined();
      expect(operationSchema?.type).toBe("string");
      expect(operationSchema?.enum).toBeDefined();
      expect(Array.isArray(operationSchema?.enum)).toBe(true);
    });

    test("operation enum contains all expected operations", () => {
      const jsonSchema = toJsonSchema(scratchpadTool.parameters) as {
        properties?: {
          operation?: {
            enum?: string[];
          };
        };
      };

      const ops = jsonSchema.properties?.operation?.enum ?? [];
      const expectedOps = [
        "step",
        "navigate",
        "branch",
        "revise",
        "complete",
        "augment",
        "override",
        "hint",
        "mistakes",
        "spot_check",
      ];

      for (const op of expectedOps) {
        expect(ops).toContain(op);
      }
    });
  });

  // Regression test: verify discriminatedUnion would fail
  describe("regression prevention", () => {
    test("z.discriminatedUnion produces invalid MCP schema (for documentation)", () => {
      // This test documents WHY we don't use discriminatedUnion
      // It shows that discriminatedUnion produces oneOf at root

      const badSchema = z.discriminatedUnion("type", [
        z.object({ type: z.literal("a"), value: z.string() }),
        z.object({ type: z.literal("b"), count: z.number() }),
      ]);

      const jsonSchema = toJsonSchema(badSchema);

      // discriminatedUnion produces oneOf - which breaks MCP
      expect(jsonSchema.oneOf).toBeDefined();
      expect(jsonSchema.type).toBeUndefined(); // No root type!
    });

    test("flat z.object produces valid MCP schema (for documentation)", () => {
      const goodSchema = z.object({
        type: z.enum(["a", "b"]),
        value: z.string().optional(),
        count: z.number().optional(),
      });

      const jsonSchema = toJsonSchema(goodSchema);

      // Flat object has type="object" at root - MCP compatible
      expect(jsonSchema.type).toBe("object");
      expect(jsonSchema.oneOf).toBeUndefined();
    });
  });
});
