import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { redactSecret, scanSecrets } from "../src/risk/secrets.js";

test("redactSecret masks middle of token", () => {
  const redacted = redactSecret("sk-AbCdEfGh1234567890XYZ");
  assert.match(redacted, /^sk-A\.\.\.\[REDACTED\]\.\.\.YZ$/);
});

test("scanSecrets detects and redacts evidence", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rs-secret-"));
  try {
    const rel = "src/config.ts";
    const abs = path.join(tmp, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, "const k = 'sk-AbCdEfGh1234567890XYZqweRTY';\n", "utf8");

    const result = await scanSecrets(
      tmp,
      [
        {
          absPath: abs,
          relPath: rel,
          sizeBytes: 40,
          ext: ".ts",
          isBinary: false,
          depth: 1,
        },
      ],
      true,
    );

    assert.ok(result.risks.length >= 1);
    assert.ok(result.risks[0].evidence[0].includes("[REDACTED]"));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("scanSecrets skips low-entropy placeholders and allowlisted entries", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rs-secret-skip-"));
  try {
    await fs.mkdir(path.join(tmp, ".reposherlock"), { recursive: true });
    await fs.writeFile(path.join(tmp, ".reposherlock", "secret-allowlist.txt"), "allowlisted-token\n", "utf8");

    const rel = "src/env.ts";
    const abs = path.join(tmp, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, "const API_KEY='example-token-123';\nconst SECRET='allowlisted-token';\n", "utf8");

    const result = await scanSecrets(
      tmp,
      [
        {
          absPath: abs,
          relPath: rel,
          sizeBytes: 120,
          ext: ".ts",
          isBinary: false,
          depth: 1,
        },
      ],
      true,
    );

    assert.equal(result.risks.length, 0);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("scanSecrets skips code-like generic assignments", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rs-secret-code-like-"));
  try {
    const rel = "src/provider.ts";
    const abs = path.join(tmp, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(
      abs,
      "const apiKey = resolveProviderApiKey(provider);\nconst token = extractCandidateToken(pattern.id, rawMatch, match);\n",
      "utf8",
    );

    const result = await scanSecrets(
      tmp,
      [
        {
          absPath: abs,
          relPath: rel,
          sizeBytes: 150,
          ext: ".ts",
          isBinary: false,
          depth: 1,
        },
      ],
      true,
    );

    assert.equal(result.risks.length, 0);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("scanSecrets suppresses synthetic sample tokens in test paths", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rs-secret-sample-"));
  try {
    const rel = "tests/fixture-keys.ts";
    const abs = path.join(tmp, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(
      abs,
      "const OPENAI='sk-12345678901234567890';\nconst AWS='AKIA1234567890ABCDEF';\n",
      "utf8",
    );

    const result = await scanSecrets(
      tmp,
      [
        {
          absPath: abs,
          relPath: rel,
          sizeBytes: 120,
          ext: ".ts",
          isBinary: false,
          depth: 2,
        },
      ],
      true,
    );

    assert.equal(result.risks.length, 0);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
