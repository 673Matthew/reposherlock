import path from "node:path";
import type { KeyFiles, RiskItem } from "../types.js";
import { readTextFileLimited } from "../utils/fs.js";

const LICENSE_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "MIT", pattern: /permission is hereby granted, free of charge/i },
  { name: "Apache-2.0", pattern: /apache license[, ]+version 2\.0/i },
  { name: "GPL-3.0", pattern: /gnu (general public license|gpl)[\s\S]*version 3/i },
  { name: "GPL-2.0", pattern: /gnu (general public license|gpl)[\s\S]*version 2/i },
  { name: "BSD-3-Clause", pattern: /redistribution and use in source and binary forms/i },
  { name: "MPL-2.0", pattern: /mozilla public license/i },
  { name: "ISC", pattern: /the isc license/i },
  { name: "Unlicense", pattern: /this is free and unencumbered software released into the public domain/i },
];

export async function detectLicenseRisk(
  rootDir: string,
  keyFiles: KeyFiles,
): Promise<{ detectedLicense: string | null; risks: RiskItem[] }> {
  const risks: RiskItem[] = [];

  if (!keyFiles.license) {
    risks.push({
      id: "license-missing",
      category: "license",
      severity: "med",
      confidence: 0.92,
      title: "LICENSE file not found",
      description: "Repository does not include a recognizable license file.",
      evidence: ["No LICENSE/LICENCE file matched in root scanning."],
    });
    return { detectedLicense: null, risks };
  }

  const licensePath = path.join(rootDir, keyFiles.license);
  const { text: content } = await readTextFileLimited(licensePath, 500_000).catch(() => ({
    text: "",
    truncated: false,
  }));
  const detected = LICENSE_PATTERNS.find((item) => item.pattern.test(content))?.name || "Unknown";

  if (detected === "Unknown") {
    risks.push({
      id: "license-unrecognized",
      category: "license",
      severity: "low",
      confidence: 0.65,
      title: "LICENSE present but unrecognized",
      description: "A license file exists but its SPDX-style type could not be confidently inferred.",
      evidence: [keyFiles.license],
    });
  }

  return {
    detectedLicense: detected,
    risks,
  };
}
