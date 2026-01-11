#!/usr/bin/env bun
/**
 * Extract a specific version's changelog section from CHANGELOG.md
 *
 * Usage:
 *   bun run scripts/extract-changelog.ts 0.1.0
 *   bun run scripts/extract-changelog.ts 0.1.0 --json
 *
 * Follows Keep a Changelog format:
 *   ## [x.y.z] - YYYY-MM-DD
 *   ### Added
 *   - Feature description
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface ChangelogSection {
  version: string;
  date: string | null;
  content: string;
  categories: Record<string, string[]>;
}

function extractChangelog(version: string, changelogPath?: string): ChangelogSection | null {
  const filePath = changelogPath ?? join(process.cwd(), "CHANGELOG.md");

  if (!existsSync(filePath)) {
    console.error(`CHANGELOG.md not found at ${filePath}`);
    return null;
  }

  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  // Pattern for version headers: ## [0.1.0] - 2024-01-01 or ## [0.1.0]
  const versionPattern = new RegExp(
    `^## \\[${escapeRegex(version)}\\](?:\\s*-\\s*(\\d{4}-\\d{2}-\\d{2}))?`,
    "i",
  );

  let capturing = false;
  const sectionLines: string[] = [];
  let date: string | null = null;

  for (const line of lines) {
    // Check if we hit our target version
    const match = line.match(versionPattern);
    if (match) {
      capturing = true;
      date = match[1] ?? null;
      continue;
    }

    // Check if we hit the next version section or footer links (stop capturing)
    if (capturing && (/^## \[/.test(line) || /^\[.+\]:/.test(line))) {
      break;
    }

    // Capture content
    if (capturing) {
      sectionLines.push(line);
    }
  }

  if (!capturing) {
    return null;
  }

  // Trim leading/trailing empty lines
  while (sectionLines.length > 0 && sectionLines[0].trim() === "") {
    sectionLines.shift();
  }
  while (sectionLines.length > 0 && sectionLines[sectionLines.length - 1].trim() === "") {
    sectionLines.pop();
  }

  // Parse into categories
  const categories: Record<string, string[]> = {};
  let currentCategory = "";

  for (const line of sectionLines) {
    const categoryMatch = line.match(/^### (.+)/);
    if (categoryMatch) {
      currentCategory = categoryMatch[1];
      categories[currentCategory] = [];
    } else if (currentCategory && line.trim().startsWith("-")) {
      categories[currentCategory].push(line.trim());
    }
  }

  return {
    version,
    date,
    content: sectionLines.join("\n"),
    categories,
  };
}

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatForGitHubRelease(section: ChangelogSection): string {
  const lines: string[] = [];

  // Add date if available
  if (section.date) {
    lines.push(`**Released:** ${section.date}`);
    lines.push("");
  }

  // Add the changelog content
  lines.push(section.content);

  // Add installation section
  lines.push("");
  lines.push("## Installation");
  lines.push("");
  lines.push("```bash");
  lines.push("npx -y verifiable-thinking-mcp");
  lines.push("```");
  lines.push("");
  lines.push("Or add to Claude Desktop config:");
  lines.push("");
  lines.push("```json");
  lines.push(`{
  "mcpServers": {
    "verifiable-thinking": {
      "command": "npx",
      "args": ["-y", "verifiable-thinking-mcp"]
    }
  }
}`);
  lines.push("```");

  return lines.join("\n");
}

// CLI execution
if (import.meta.main) {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes("--json");
  const version = args.find((a) => !a.startsWith("--"));

  if (!version) {
    console.error("Usage: bun run scripts/extract-changelog.ts <version> [--json]");
    console.error("Example: bun run scripts/extract-changelog.ts 0.1.0");
    process.exit(1);
  }

  const section = extractChangelog(version);

  if (!section) {
    console.error(`Version ${version} not found in CHANGELOG.md`);
    process.exit(1);
  }

  if (jsonOutput) {
    console.log(JSON.stringify(section, null, 2));
  } else {
    console.log(formatForGitHubRelease(section));
  }
}

export { extractChangelog, formatForGitHubRelease, type ChangelogSection };
