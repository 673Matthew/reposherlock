import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectLicenseRisk } from "../src/risk/license.js";

test("detectLicenseRisk recognizes MIT license", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rs-license-"));
  try {
    await fs.writeFile(
      path.join(tmp, "LICENSE"),
      "Permission is hereby granted, free of charge, to any person obtaining a copy...",
      "utf8",
    );

    const result = await detectLicenseRisk(tmp, {
      readmeFiles: [],
      ciWorkflows: [],
      entrypoints: [],
      license: "LICENSE",
    });

    assert.equal(result.detectedLicense, "MIT");
    assert.equal(result.risks.length, 0);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
