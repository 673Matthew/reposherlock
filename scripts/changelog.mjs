#!/usr/bin/env node
import fs from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const [, , versionArg] = process.argv;
if (!versionArg) {
  console.error("Usage: node scripts/changelog.mjs <version>");
  process.exit(1);
}

const version = versionArg.replace(/^v/, "");
const cwd = process.cwd();
const changelogPath = path.join(cwd, "CHANGELOG.md");

const now = new Date().toISOString().slice(0, 10);
const previousTag = getPreviousTag();
const range = previousTag ? `${previousTag}..HEAD` : "HEAD";
const commits = getCommitSubjects(range);

const section = renderSection(version, now, commits, previousTag);
const existing = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, "utf8") : "# Changelog\n\n";

let next = existing;
if (!existing.startsWith("# Changelog")) {
  next = `# Changelog\n\n${existing}`;
}

const header = "# Changelog\n\n";
const body = next.startsWith(header) ? next.slice(header.length) : next;
fs.writeFileSync(changelogPath, `${header}${section}\n${body.trimStart()}`);

console.log(`Updated CHANGELOG.md for v${version}`);

function getPreviousTag() {
  try {
    const out = execSync("git describe --tags --abbrev=0", { encoding: "utf8" }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function getCommitSubjects(rangeExpr) {
  try {
    const out = execSync(`git log --pretty=format:%s ${rangeExpr}`, { encoding: "utf8" }).trim();
    if (!out) return [];
    return out.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function renderSection(versionValue, date, subjects, previous) {
  const groups = {
    Features: [],
    Fixes: [],
    Refactors: [],
    Documentation: [],
    Tests: [],
    Chore: [],
    Other: [],
  };

  for (const subject of subjects) {
    const lower = subject.toLowerCase();
    if (lower.startsWith("feat:")) groups.Features.push(subject);
    else if (lower.startsWith("fix:")) groups.Fixes.push(subject);
    else if (lower.startsWith("refactor:")) groups.Refactors.push(subject);
    else if (lower.startsWith("docs:")) groups.Documentation.push(subject);
    else if (lower.startsWith("test:") || lower.startsWith("tests:")) groups.Tests.push(subject);
    else if (lower.startsWith("chore:") || lower.startsWith("build:") || lower.startsWith("ci:")) groups.Chore.push(subject);
    else groups.Other.push(subject);
  }

  const lines = [];
  lines.push(`## v${versionValue} - ${date}`);
  lines.push("");
  if (previous) {
    lines.push(`Changes since ${previous}:`);
    lines.push("");
  }

  for (const [label, items] of Object.entries(groups)) {
    if (items.length === 0) continue;
    lines.push(`### ${label}`);
    for (const item of items) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  if (subjects.length === 0) {
    lines.push("- No commit messages found for this release range.");
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
