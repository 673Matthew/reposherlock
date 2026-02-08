import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  isLocalDirectoryTarget,
  isSupportedRepoTarget,
  validateRepoTargetOrThrow,
} from "../src/ingest/target.js";

test("validateRepoTargetOrThrow accepts GitHub URLs", () => {
  const result = validateRepoTargetOrThrow("https://github.com/octocat/Hello-World");
  assert.equal(result.kind, "github-url");
  assert.equal(result.normalizedInput, "https://github.com/octocat/Hello-World");
  assert.equal(result.resolvedLocalPath, undefined);
});

test("validateRepoTargetOrThrow accepts local directories", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reposherlock-target-"));
  const repoDir = path.join(tempRoot, "repo");
  fs.mkdirSync(repoDir, { recursive: true });

  try {
    assert.equal(isLocalDirectoryTarget("./repo", tempRoot), true);
    assert.equal(isSupportedRepoTarget("./repo", tempRoot), true);

    const result = validateRepoTargetOrThrow("./repo", tempRoot);
    assert.equal(result.kind, "local-path");
    assert.equal(result.normalizedInput, "./repo");
    assert.equal(result.resolvedLocalPath, repoDir);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("validateRepoTargetOrThrow rejects unsupported targets", () => {
  assert.equal(isSupportedRepoTarget("https://gitlab.com/org/repo"), false);
  assert.throws(
    () => validateRepoTargetOrThrow("https://gitlab.com/org/repo"),
    /Invalid target:/,
  );
});
