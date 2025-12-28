import { FastMCP } from "fastmcp";
import { 
  thinkTool, 
  listSessionsTool, 
  getSessionTool, 
  clearSessionTool,
  compressTool,
} from "./tools/index.ts";
import { allPrompts } from "./prompts/index.ts";
import { allResources, allResourceTemplates } from "./resources/index.ts";

const server = new FastMCP({
  name: "Verifiable Thinking MCP",
  version: "0.1.0",
});

// Register tools
server.addTool(thinkTool);
server.addTool(listSessionsTool);
server.addTool(getSessionTool);
server.addTool(clearSessionTool);
server.addTool(compressTool);

// Register prompts
for (const prompt of allPrompts) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.addPrompt(prompt as any);
}

// Register resources
for (const resource of allResources) {
  server.addResource(resource);
}

// Register resource templates
for (const template of allResourceTemplates) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.addResourceTemplate(template as any);
}

// Start server (stdio for local MCP agents like Claude Desktop)
server.start({ transportType: "stdio" });
