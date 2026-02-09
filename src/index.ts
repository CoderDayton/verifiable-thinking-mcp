import { createRequire } from "node:module";
import { FastMCP } from "fastmcp";
import { allResources, allResourceTemplates } from "./resources/index.ts";
import {
  clearSessionTool,
  compressTool,
  getSessionTool,
  listSessionsTool,
  scratchpadTool,
} from "./tools/index.ts";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const server = new FastMCP({
  name: "Verifiable Thinking MCP",
  version,
});

// Register tools
server.addTool(scratchpadTool);
server.addTool(listSessionsTool);
server.addTool(getSessionTool);
server.addTool(clearSessionTool);
server.addTool(compressTool);

// NOTE: MCP prompts disabled - opencode v1.1.4 doesn't support prompt execution
// Re-enable when opencode implements prompts/get (see sst/opencode#5767)

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
