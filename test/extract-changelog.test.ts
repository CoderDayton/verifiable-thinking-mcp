import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { extractChangelog, formatForGitHubRelease } from "../scripts/extract-changelog";

describe("extract-changelog", () => {
  const changelogPath = join(import.meta.dir, "..", "CHANGELOG.md");

  describe("extractChangelog", () => {
    it("extracts version 0.1.0 from CHANGELOG.md", () => {
      const section = extractChangelog("0.1.0", changelogPath);

      expect(section).not.toBeNull();
      expect(section!.version).toBe("0.1.0");
      expect(section!.date).toBe("2026-01-11");
      expect(section!.content).toContain("Scratchpad tool");
      expect(section!.content).toContain("Cognitive trap detection");
    });

    it("parses categories correctly", () => {
      const section = extractChangelog("0.1.0", changelogPath);

      expect(section).not.toBeNull();
      expect(section!.categories).toHaveProperty("Added");
      expect(section!.categories).toHaveProperty("Security");
      expect(section!.categories.Added.length).toBeGreaterThan(0);
      expect(section!.categories.Security.length).toBeGreaterThan(0);
    });

    it("returns null for non-existent version", () => {
      const section = extractChangelog("99.99.99", changelogPath);
      expect(section).toBeNull();
    });

    it("excludes footer links from content", () => {
      const section = extractChangelog("0.1.0", changelogPath);

      expect(section).not.toBeNull();
      expect(section!.content).not.toContain("[Unreleased]:");
      expect(section!.content).not.toContain("[0.1.0]:");
    });
  });

  describe("formatForGitHubRelease", () => {
    it("includes release date when available", () => {
      const section = extractChangelog("0.1.0", changelogPath);
      const formatted = formatForGitHubRelease(section!);

      expect(formatted).toContain("**Released:** 2026-01-11");
    });

    it("includes installation instructions", () => {
      const section = extractChangelog("0.1.0", changelogPath);
      const formatted = formatForGitHubRelease(section!);

      expect(formatted).toContain("## Installation");
      expect(formatted).toContain("npx -y verifiable-thinking-mcp");
      expect(formatted).toContain("mcpServers");
    });

    it("preserves changelog content", () => {
      const section = extractChangelog("0.1.0", changelogPath);
      const formatted = formatForGitHubRelease(section!);

      expect(formatted).toContain("### Added");
      expect(formatted).toContain("Scratchpad tool");
      expect(formatted).toContain("### Security");
    });
  });
});
