import path from "node:path";
import type { KeyFiles, RiskItem } from "../types.js";
import { readTextFileLimited } from "../utils/fs.js";

const CURATED_DEP_RISKS: Record<string, { note: string; severity: "low" | "med" | "high" }> = {
  request: {
    note: "Deprecated HTTP client package; consider migration.",
    severity: "med",
  },
  "node-sass": {
    note: "Legacy Sass implementation; consider using sass package.",
    severity: "low",
  },
  "gulp-util": {
    note: "Deprecated package; replace with maintained alternatives.",
    severity: "med",
  },
  "babel-eslint": {
    note: "Deprecated parser; prefer @babel/eslint-parser.",
    severity: "low",
  },
  "left-pad": {
    note: "Small utility dependency; evaluate whether it is still necessary.",
    severity: "low",
  },
  "event-stream": {
    note: "Historically abused package; review necessity and pin versions.",
    severity: "med",
  },
};

export async function detectDependencyRisks(rootDir: string, keyFiles: KeyFiles): Promise<RiskItem[]> {
  const risks: RiskItem[] = [];

  if (keyFiles.packageJson) {
    const packagePath = path.join(rootDir, keyFiles.packageJson);
    const { text: packageText } = await readTextFileLimited(packagePath, 600_000).catch(() => ({
      text: "",
      truncated: false,
    }));
    if (packageText) {
      const pkg = JSON.parse(packageText) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      for (const [name, version] of Object.entries(deps)) {
        const match = CURATED_DEP_RISKS[name];
        if (match) {
          risks.push({
            id: `dep-risk-${name}`,
            category: "dependency",
            severity: match.severity,
            confidence: 0.75,
            title: `Potential dependency risk: ${name}`,
            description: `${match.note} This is heuristic and not a CVE claim.`,
            evidence: [`${name}@${version}`],
          });
        }
      }
    }
  }

  return risks;
}
