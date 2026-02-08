export type Severity = "low" | "med" | "high";
export type LlmProviderType = "openai" | "gemini" | "anthropic" | "grok" | "ollama" | "openai-compatible";

export interface AnalyzeOptions {
  outDir: string;
  format: Array<"md" | "json">;
  depth: number;
  maxFiles: number;
  includeTests: boolean;
  tryRun: boolean;
  timeoutSeconds: number;
  noNetwork: boolean;
  redactSecrets: boolean;
  verbose: boolean;
  llm: boolean;
  llmProvider: LlmProviderType;
  llmModel?: string;
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmMaxChars: number;
  llmPerFileChars: number;
  tryRunPython: boolean;
  tryRunPolicyPath?: string;
  prDraft?: boolean;
  animation: boolean;
}

export interface RepoIdentity {
  input: string;
  resolvedPath: string;
  displayName: string;
  sourceType: "local" | "github-clone" | "github-zip";
  commitOrRef?: string;
}

export interface ConfigSnapshot {
  analyzeOptions: AnalyzeOptions;
  generatedAt: string;
  toolVersion: string;
}

export interface FileIndexEntry {
  absPath: string;
  relPath: string;
  sizeBytes: number;
  ext: string;
  isBinary: boolean;
  depth: number;
}

export interface KeyFiles {
  readmeFiles: string[];
  packageJson?: string;
  bunLock?: string;
  pnpmLock?: string;
  yarnLock?: string;
  dockerfile?: string;
  dockerCompose?: string;
  requirementsTxt?: string;
  pyprojectToml?: string;
  makefile?: string;
  license?: string;
  envExample?: string;
  ciWorkflows: string[];
  entrypoints: string[];
}

export interface LanguageBreakdown {
  language: string;
  count: number;
  bytes: number;
}

export interface ProjectClassification {
  projectType: "library" | "app" | "cli" | "service" | "web" | "unknown";
  runtime: "bun" | "node" | "python" | "go" | "rust" | "other";
  frameworkGuess: string | null;
  confidence: number;
}

export interface RunGuess {
  installCommands: string[];
  runCommands: string[];
  testCommands: string[];
  configHints: string[];
}

export interface EvidenceRef {
  source: string;
  path: string;
  snippet: string;
}

export interface EnvVariableHint {
  name: string;
  confidence: number;
  evidence: EvidenceRef[];
}

export interface EnvAnalysis {
  required: EnvVariableHint[];
  requiredByFlags: EnvVariableHint[];
  optional: EnvVariableHint[];
  mentioned: EnvVariableHint[];
  filteredOut: string[];
}

export interface FormattingInsight {
  ecosystem?: "javascript" | "python" | "mixed" | "unknown";
  detectedTools: string[];
  dependencyTools: string[];
  configFiles: string[];
  hasFormatScript: boolean;
  hasLintScript: boolean;
  formatScriptNames: string[];
  lintScriptNames: string[];
  evidence: EvidenceRef[];
}

export interface QualitySignal {
  id: string;
  severity: Severity;
  confidence: number;
  title: string;
  description: string;
  evidence: string[];
}

export interface AnalysisMetrics {
  filesScanned: number;
  textFilesScanned: number;
  tsJsFiles: number;
  tsJsParsed: number;
  parsedModules: number;
  moduleMapCoverage: number;
  skippedBinaryOrLarge: number;
  warningsCount: number;
}

export interface SummaryEvidence {
  classification: EvidenceRef[];
  purpose: EvidenceRef[];
  run: EvidenceRef[];
  env: EvidenceRef[];
  architecture: EvidenceRef[];
}

export interface ModuleNode {
  id: string;
  path: string;
  degree: number;
}

export interface ModuleEdge {
  from: string;
  to: string;
}

export interface ArchitectureMap {
  nodes: ModuleNode[];
  edges: ModuleEdge[];
  topModules: ModuleNode[];
  metrics: {
    sourceFiles: number;
    parsedFiles: number;
    tsJsSourceFiles: number;
    tsJsParsedFiles: number;
    connectedFiles: number;
    parseCoverage: number;
    tsJsCoverage: number;
    filesWithEdges?: number;
    tsJsFilesWithEdges?: number;
    tsJsGraphYield?: number;
  };
}

export interface RiskItem {
  id: string;
  category: "license" | "secret" | "dependency" | "ci" | "quality";
  severity: Severity;
  confidence: number;
  title: string;
  description: string;
  evidence: string[];
  redacted?: boolean;
}

export interface IssueItem {
  id: string;
  title: string;
  body: string;
  labels: string[];
  severity: Severity;
  confidence: number;
  evidence: string[];
}

export interface RunAttemptResult {
  attempted: boolean;
  planner: RunPlan;
  executions: CommandExecution[];
  summary: string;
}

export interface CommandExecution {
  command: string;
  args: string[];
  step: "install" | "test" | "build" | "start" | "lint" | "run";
  helpMode: boolean;
  cwd: string;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
  stdoutSnippet: string;
  stderrSnippet: string;
  classification: RunFailureClass | "success";
  verificationStatus: "verified" | "partial" | "failed" | "skipped";
  verificationEvidence: string;
  probableFixes: string[];
}

export type RunFailureClass =
  | "missing-env"
  | "missing-deps"
  | "port-conflict"
  | "test-fail"
  | "permission"
  | "unknown";

export interface RunPlan {
  strategy: "docker" | "node-bun" | "python" | "none";
  reason: string;
  proposedCommands: string[];
  executableCommands: PlannedCommand[];
}

export interface TryRunPolicy {
  source: string;
  scriptPriority: string[];
  allowedCommands: string[];
  allowedScriptEntrypoints: string[];
  blockedScriptEntrypoints: string[];
}

export interface PlannedCommand {
  command: string;
  args: string[];
  run: boolean;
  why: string;
}

export interface DeterministicSummary {
  repoIdentity: RepoIdentity;
  generatedAt: string;
  languageBreakdown: LanguageBreakdown[];
  metrics?: AnalysisMetrics;
  keyFiles: KeyFiles;
  classification: ProjectClassification;
  runGuess: RunGuess;
  envAnalysis?: EnvAnalysis;
  formatting?: FormattingInsight;
  qualitySignals?: QualitySignal[];
  evidence?: SummaryEvidence;
  architecture: ArchitectureMap;
  risks: RiskItem[];
  issues: IssueItem[];
  tryRun?: RunAttemptResult;
}

export interface LlmConfig {
  provider: LlmProviderType;
  model: string;
  baseUrl: string;
  apiKey?: string;
  maxChars: number;
  perFileChars: number;
}

export interface SafeLlmFileExcerpt {
  file: string;
  content: string;
  truncated: boolean;
}

export interface LlmPromptPack {
  disclaimer: string;
  summaryJson: string;
  excerpts: SafeLlmFileExcerpt[];
  totalChars: number;
  droppedFiles: string[];
}

export interface LlmEnhancementOutput {
  purposeSummary?: string;
  readme?: string;
  issuesJson?: IssueItem[];
  report?: string;
  notes: string[];
}

export interface ReportBundle {
  reportMarkdown: string;
  reportJson: DeterministicSummary;
  architectureMmd: string;
  risksMarkdown: string;
  risksJson: RiskItem[];
  issuesJson: IssueItem[];
  readme20: string;
  runAttemptMarkdown?: string;
  runAttemptJson?: RunAttemptResult;
}

export interface StageLogEntry {
  ts: string;
  stage: string;
  event: "start" | "end" | "warn" | "error";
  durationMs?: number;
  inputSummary?: Record<string, unknown>;
  counts?: Record<string, number>;
  warnings?: string[];
  error?: string;
}

export interface DoctorCheck {
  tool: string;
  available: boolean;
  version?: string;
  note?: string;
}

export interface DoctorReport {
  timestamp: string;
  checks: DoctorCheck[];
  llmEnv: {
    provider: LlmProviderType;
    baseUrl: string;
    hasApiKey: boolean;
    model: string;
  };
}

export interface PipelineContext {
  options: AnalyzeOptions;
  workspaceRoot: string;
  outputDir: string;
  logger: Logger;
}

export interface Logger {
  log(entry: StageLogEntry): Promise<void>;
  stageStart(stage: string, inputSummary?: Record<string, unknown>): Promise<number>;
  stageEnd(
    stage: string,
    startedAt: number,
    counts?: Record<string, number>,
    warnings?: string[],
  ): Promise<void>;
  stageError(stage: string, startedAt: number, error: unknown): Promise<void>;
}
