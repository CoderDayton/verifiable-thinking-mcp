#!/usr/bin/env bun
/**
 * Coverage threshold enforcement script
 * Parses lcov.info and fails if coverage drops below configured thresholds
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

  for (const line of content.split("\n")) {
    if (line.startsWith("LF:")) stats.linesFound += parseInt(line.slice(3), 10);
    if (line.startsWith("LH:")) stats.linesHit += parseInt(line.slice(3), 10);
    if (line.startsWith("FNF:")) stats.functionsFound += parseInt(line.slice(4), 10);
    if (line.startsWith("FNH:")) stats.functionsHit += parseInt(line.slice(4), 10);
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
