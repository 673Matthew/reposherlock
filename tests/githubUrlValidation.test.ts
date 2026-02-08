import test from "node:test";
import assert from "node:assert/strict";
import {
  isGitHubRepoUrl,
  parseGitHubRepoUrl,
  validateGitHubRepoUrlOrThrow,
} from "../src/ingest/github.js";

test("parseGitHubRepoUrl normalizes common github URL variants", () => {
  const cases = [
    "https://github.com/octocat/Hello-World",
    "https://github.com/octocat/Hello-World.git",
    "https://github.com/octocat/Hello-World/tree/main",
    "https://www.github.com/octocat/Hello-World",
    "github.com/octocat/Hello-World",
  ];

  for (const value of cases) {
    const parsed = parseGitHubRepoUrl(value);
    assert.ok(parsed, `expected parse success for ${value}`);
    assert.equal(parsed?.owner, "octocat");
    assert.equal(parsed?.repo, "Hello-World");
    assert.equal(parsed?.normalizedUrl, "https://github.com/octocat/Hello-World");
  }
});

test("parseGitHubRepoUrl rejects non-repo and non-github inputs", () => {
  const invalid = [
    "",
    ".",
    "/tmp/repo",
    "https://gitlab.com/org/repo",
    "https://github.com/",
    "https://github.com/octocat",
    "not-a-url",
  ];

  for (const value of invalid) {
    assert.equal(isGitHubRepoUrl(value), false, `expected invalid for ${value}`);
  }
});

test("validateGitHubRepoUrlOrThrow throws for invalid input", () => {
  assert.throws(() => validateGitHubRepoUrlOrThrow("abc"), /Invalid repository URL/);
});
