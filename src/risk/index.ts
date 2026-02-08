import type { FileIndexEntry, FormattingInsight, KeyFiles, QualitySignal, RiskItem } from "../types.js";
import { detectLicenseRisk } from "./license.js";
import { scanSecrets } from "./secrets.js";
import { detectDependencyRisks } from "./dependency.js";
import { detectCiAndQuality } from "./ci.js";

export interface RiskScanResult {
  detectedLicense: string | null;
  risks: RiskItem[];
  secretFindings: number;
  qualitySignals: QualitySignal[];
  formatting: FormattingInsight;
}

export async function runRiskAnalysis(
  rootDir: string,
  keyFiles: KeyFiles,
  fileIndex: FileIndexEntry[],
  redactSecrets: boolean,
): Promise<RiskScanResult> {
  const license = await detectLicenseRisk(rootDir, keyFiles);
  const secrets = await scanSecrets(rootDir, fileIndex, redactSecrets);
  const deps = await detectDependencyRisks(rootDir, keyFiles);
  const ciQuality = await detectCiAndQuality(rootDir, keyFiles, fileIndex);

  return {
    detectedLicense: license.detectedLicense,
    risks: [...license.risks, ...secrets.risks, ...deps, ...ciQuality.risks],
    secretFindings: secrets.findingsCount,
    qualitySignals: ciQuality.qualitySignals,
    formatting: ciQuality.formatting,
  };
}
