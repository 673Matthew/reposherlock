#!/usr/bin/env node
import fs from "node:fs";
import { execSync } from "node:child_process";

const [, , bumpArg = "patch"] = process.argv;
const bump = normalizeBump(bumpArg);
if (!bump) {
  console.error("Invalid bump value. Use patch|minor|major or explicit semver like 1.2.3");
  process.exit(1);
}

ensureCleanTree();

execSync(`npm version ${bump} --no-git-tag-version`, { stdio: "inherit" });
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const version = pkg.version;

execSync(`node scripts/changelog.mjs ${version}`, { stdio: "inherit" });

execSync("git add package.json package-lock.json CHANGELOG.md", { stdio: "inherit" });
execSync(`git commit -m \"release: v${version}\"`, { stdio: "inherit" });
execSync(`git tag v${version}`, { stdio: "inherit" });

console.log(`Prepared release v${version}`);
console.log("Run: git push origin HEAD && git push origin v" + version);

function ensureCleanTree() {
  const out = execSync("git status --porcelain", { encoding: "utf8" }).trim();
  if (out) {
    console.error("Git working tree is not clean. Commit or stash changes before release.");
    process.exit(1);
  }
}

function normalizeBump(value) {
  if (["patch", "minor", "major"].includes(value)) {
    return value;
  }

  if (/^\d+\.\d+\.\d+$/.test(value)) {
    return value;
  }

  return null;
}
