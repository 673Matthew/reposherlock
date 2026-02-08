import type { ConfigSnapshot, IssueItem, RepoIdentity } from "../types.js";

export interface SarifDocument {
  version: "2.1.0";
  $schema: string;
  runs: Array<{
    tool: {
      driver: {
        name: string;
        version: string;
        informationUri: string;
        rules: Array<{
          id: string;
          shortDescription: { text: string };
          fullDescription: { text: string };
          defaultConfiguration: { level: "error" | "warning" | "note" };
          properties: Record<string, unknown>;
        }>;
      };
    };
    results: Array<{
      ruleId: string;
      level: "error" | "warning" | "note";
      message: { text: string };
      locations?: Array<{
        physicalLocation: {
          artifactLocation: { uri: string };
        };
      }>;
      properties: Record<string, unknown>;
    }>;
    properties: Record<string, unknown>;
  }>;
}

export function buildIssuesSarif(input: {
  issues: IssueItem[];
  repoIdentity: RepoIdentity;
  generatedAt: string;
  config: ConfigSnapshot;
}): SarifDocument {
  const rules = input.issues.map((issue) => ({
    id: issue.id,
    shortDescription: { text: issue.title },
    fullDescription: { text: issue.body.slice(0, 4000) },
    defaultConfiguration: { level: severityToSarifLevel(issue.severity) },
    properties: {
      severity: issue.severity,
      confidence: issue.confidence,
      labels: issue.labels,
    },
  }));

  const results = input.issues.map((issue) => {
    const firstEvidence = issue.evidence[0] || "";
    const maybePath = extractEvidencePath(firstEvidence);

    return {
      ruleId: issue.id,
      level: severityToSarifLevel(issue.severity),
      message: {
        text: `${issue.title}\n\n${issue.body}`.slice(0, 8000),
      },
      ...(maybePath
        ? {
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: maybePath },
                },
              },
            ],
          }
        : {}),
      properties: {
        confidence: issue.confidence,
        severity: issue.severity,
        evidence: issue.evidence,
      },
    };
  });

  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "RepoSherlock",
            version: input.config.toolVersion,
            informationUri: "https://github.com/",
            rules,
          },
        },
        results,
        properties: {
          generatedAt: input.generatedAt,
          repo: input.repoIdentity,
          config: input.config.analyzeOptions,
        },
      },
    ],
  };
}

function severityToSarifLevel(severity: IssueItem["severity"]): "error" | "warning" | "note" {
  if (severity === "high") return "error";
  if (severity === "med") return "warning";
  return "note";
}

function extractEvidencePath(evidence: string): string | null {
  if (!evidence) {
    return null;
  }

  const left = evidence.split(":")[0]?.trim();
  if (!left) {
    return null;
  }

  if (left.includes("/") || left.includes("\\") || left.endsWith(".ts") || left.endsWith(".js") || left.endsWith(".py")) {
    return left;
  }

  return null;
}
