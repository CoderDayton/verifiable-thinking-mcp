import { FastMCP } from "fastmcp";
import { allPrompts } from "./prompts/index.ts";
import { allResources, allResourceTemplates } from "./resources/index.ts";
import {
  clearSessionTool,
  compressTool,
  getSessionTool,
  listSessionsTool,
  scratchpadTool,
} from "./tools/index.ts";

const server = new FastMCP({
  name: "Verifiable Thinking MCP",
  version: "0.1.0",
});

// Register tools
server.addTool(scratchpadTool);
server.addTool(listSessionsTool);
server.addTool(getSessionTool);
server.addTool(clearSessionTool);
server.addTool(compressTool);

// Register prompts
for (const prompt of allPrompts) {
  // biome-ignore lint/suspicious/noExplicitAny: FastMCP prompt type mismatch
  server.addPrompt(prompt as any);
}

// Register resources
for (const resource of allResources) {
  server.addResource(resource);
}

// Register resource templates
for (const template of allResourceTemplates) {
  // biome-ignore lint/suspicious/noExplicitAny: FastMCP template type mismatch
  server.addResourceTemplate(template as any);
}

// Start server (stdio for local MCP agents like Claude Desktop)
server.start({ transportType: "stdio" });
