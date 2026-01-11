#!/usr/bin/env bun
/**
 * Coverage threshold enforcement script
 * Parses lcov.info and fails if coverage drops below configured thresholds
 *
 * Excludes src/tools/ from threshold checks - tools are integration-tested via MCP
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface Thresholds {
  lines: number;
  functions: number;
}

interface CoverageStats {
  linesFound: number;
  linesHit: number;
  functionsFound: number;
  functionsHit: number;
}

/** Patterns to exclude from coverage threshold enforcement */
const EXCLUDE_PATTERNS = [
  /^src\/tools\//, // Tools are integration-tested via MCP, not unit-tested
  /^src\/index\.ts$/, // Entry point
];

function shouldExclude(filePath: string): boolean {
  return EXCLUDE_PATTERNS.some((pattern) => pattern.test(filePath));
}

function loadThresholds(): Thresholds {
  const pkgPath = join(import.meta.dir, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  return pkg.coverage?.threshold ?? { lines: 80, functions: 80 };
}

function parseLcov(lcovPath: string): CoverageStats {
  if (!existsSync(lcovPath)) {
    console.error(`❌ Coverage file not found: ${lcovPath}`);
    console.error("   Run 'bun test --coverage' first");
    process.exit(1);
  }

  const content = readFileSync(lcovPath, "utf-8");
  const stats: CoverageStats = {
    linesFound: 0,
    linesHit: 0,
    functionsFound: 0,
    functionsHit: 0,
  };

  let currentFile = "";
  let fileStats: CoverageStats = { linesFound: 0, linesHit: 0, functionsFound: 0, functionsHit: 0 };

  for (const line of content.split("\n")) {
    if (line.startsWith("SF:")) {
      // New source file - commit previous if not excluded
      if (currentFile && !shouldExclude(currentFile)) {
        stats.linesFound += fileStats.linesFound;
        stats.linesHit += fileStats.linesHit;
        stats.functionsFound += fileStats.functionsFound;
        stats.functionsHit += fileStats.functionsHit;
      }
      // Extract relative path (remove leading ./ or absolute path prefix)
      currentFile = line.slice(3).replace(/^.*?src\//, "src/");
      fileStats = { linesFound: 0, linesHit: 0, functionsFound: 0, functionsHit: 0 };
    } else if (line.startsWith("LF:")) {
      fileStats.linesFound = parseInt(line.slice(3), 10);
    } else if (line.startsWith("LH:")) {
      fileStats.linesHit = parseInt(line.slice(3), 10);
    } else if (line.startsWith("FNF:")) {
      fileStats.functionsFound = parseInt(line.slice(4), 10);
    } else if (line.startsWith("FNH:")) {
      fileStats.functionsHit = parseInt(line.slice(4), 10);
    } else if (line === "end_of_record") {
      // Commit final file stats if not excluded
      if (currentFile && !shouldExclude(currentFile)) {
        stats.linesFound += fileStats.linesFound;
        stats.linesHit += fileStats.linesHit;
        stats.functionsFound += fileStats.functionsFound;
        stats.functionsHit += fileStats.functionsHit;
      }
      currentFile = "";
    }
  }

  return stats;
}

function main() {
  const lcovPath = join(import.meta.dir, "..", "coverage", "lcov.info");
  const thresholds = loadThresholds();
  const stats = parseLcov(lcovPath);

  const lineCoverage = stats.linesFound > 0 ? (stats.linesHit / stats.linesFound) * 100 : 0;
  const functionCoverage =
    stats.functionsFound > 0 ? (stats.functionsHit / stats.functionsFound) * 100 : 0;

  console.log("\n📊 Coverage Threshold Check");
  console.log("═".repeat(40));
  console.log(`Lines:     ${lineCoverage.toFixed(2)}% (threshold: ${thresholds.lines}%)`);
  console.log(`Functions: ${functionCoverage.toFixed(2)}% (threshold: ${thresholds.functions}%)`);
  console.log("─".repeat(40));
  console.log("Excluded:  src/tools/*, src/index.ts");
  console.log("═".repeat(40));

  let failed = false;

  if (lineCoverage < thresholds.lines) {
    console.error(
      `\n❌ Line coverage ${lineCoverage.toFixed(2)}% is below threshold ${thresholds.lines}%`,
    );
    failed = true;
  }

  if (functionCoverage < thresholds.functions) {
    console.error(
      `\n❌ Function coverage ${functionCoverage.toFixed(2)}% is below threshold ${thresholds.functions}%`,
    );
    failed = true;
  }

  if (failed) {
    console.error("\n💡 Tip: Add tests to improve coverage before merging");
    process.exit(1);
  }

  console.log("\n✅ Coverage thresholds passed!");
}

main();
