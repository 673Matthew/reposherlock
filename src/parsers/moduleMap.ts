import path from "node:path";
import type { ArchitectureMap, FileIndexEntry, ModuleEdge, ModuleNode } from "../types.js";
import { parseTsImports } from "./tsImports.js";
import { parsePythonImports } from "./pythonImports.js";
import { toPosixPath } from "../utils/path.js";
import { readTextFileLimited } from "../utils/fs.js";

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"]);

export async function buildArchitectureMap(
  rootDir: string,
  index: FileIndexEntry[],
  maxReadBytes = 250_000,
): Promise<ArchitectureMap> {
  const sourceFiles = index.filter((file) => SOURCE_EXTS.has(file.ext));
  const tsJsSourceFiles = sourceFiles.filter((file) => file.ext !== ".py");
  const edges = new Set<string>();
  const degreeMap = new Map<string, number>();
  const filesWithEdges = new Set<string>();
  let parsedFiles = 0;
  let tsJsParsedFiles = 0;

  const jsCandidates = new Map<string, string>();
  const pyCandidates = new Map<string, string>();

  for (const file of sourceFiles) {
    const noExt = stripExt(file.relPath);
    jsCandidates.set(toPosixPath(noExt), file.relPath);
    pyCandidates.set(toPosixPath(noExt).replace(/\//g, "."), file.relPath);
  }

  for (const file of sourceFiles) {
    const abs = path.join(rootDir, file.relPath);
    const { text } = await readTextFileLimited(abs, maxReadBytes).catch(() => ({ text: "", truncated: false }));
    const limited = text;

    if (!limited) {
      continue;
    }
    parsedFiles += 1;
    if (file.ext !== ".py") {
      tsJsParsedFiles += 1;
    }

    const imports = file.ext === ".py" ? parsePythonImports(limited) : parseTsImports(limited);
    const resolved = imports
      .map((imp) => resolveImport(file.relPath, imp, jsCandidates, pyCandidates, file.ext === ".py"))
      .filter((x): x is string => Boolean(x));

    for (const dep of resolved) {
      const key = `${file.relPath}=>${dep}`;
      if (dep !== file.relPath) {
        edges.add(key);
      }
    }
  }

  const edgeList: ModuleEdge[] = Array.from(edges).map((edge) => {
    const [from, to] = edge.split("=>");
    degreeMap.set(from, (degreeMap.get(from) || 0) + 1);
    degreeMap.set(to, (degreeMap.get(to) || 0) + 1);
    return { from, to };
  });

  const nodeIds = new Set<string>();
  for (const edge of edgeList) {
    filesWithEdges.add(edge.from);
    filesWithEdges.add(edge.to);
    nodeIds.add(edge.from);
    nodeIds.add(edge.to);
  }

  for (const file of sourceFiles) {
    nodeIds.add(file.relPath);
  }

  const nodes: ModuleNode[] = Array.from(nodeIds)
    .map((id) => ({ id, path: id, degree: degreeMap.get(id) || 0 }))
    .sort((a, b) => b.degree - a.degree || a.path.localeCompare(b.path));

  const parseCoverage = sourceFiles.length === 0 ? 0 : Number((parsedFiles / sourceFiles.length).toFixed(3));
  const tsJsCoverage = tsJsSourceFiles.length === 0 ? 0 : Number((tsJsParsedFiles / tsJsSourceFiles.length).toFixed(3));
  const tsJsFilesWithEdges = Array.from(filesWithEdges).filter((file) => !file.endsWith(".py")).length;
  const tsJsGraphYield =
    tsJsSourceFiles.length === 0 ? 0 : Number((tsJsFilesWithEdges / tsJsSourceFiles.length).toFixed(3));

  return {
    nodes,
    edges: edgeList,
    topModules: nodes.slice(0, 10),
    metrics: {
      sourceFiles: sourceFiles.length,
      parsedFiles,
      tsJsSourceFiles: tsJsSourceFiles.length,
      tsJsParsedFiles,
      connectedFiles: filesWithEdges.size,
      parseCoverage,
      tsJsCoverage,
      filesWithEdges: filesWithEdges.size,
      tsJsFilesWithEdges,
      tsJsGraphYield,
    },
  };
}

function stripExt(relPath: string): string {
  const ext = path.extname(relPath);
  if (!ext) {
    return relPath;
  }
  return relPath.slice(0, -ext.length);
}

function resolveImport(
  fromFile: string,
  specifier: string,
  jsCandidates: Map<string, string>,
  pyCandidates: Map<string, string>,
  isPython: boolean,
): string | null {
  if (!specifier) {
    return null;
  }

  if (!isPython) {
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
      return null;
    }

    const baseDir = path.dirname(fromFile);
    const raw = toPosixPath(path.normalize(path.join(baseDir, specifier)));
    const withoutKnownExt = stripKnownJsExt(raw);
    const candidates = [raw, withoutKnownExt, `${raw}/index`, `${withoutKnownExt}/index`];

    for (const candidate of candidates) {
      const exact = jsCandidates.get(candidate);
      if (exact) {
        return exact;
      }
      for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
        const withExt = jsCandidates.get(`${candidate}${ext}`);
        if (withExt) {
          return withExt;
        }
      }
    }
    return null;
  }

  if (specifier.startsWith(".")) {
    const level = specifier.match(/^\.+/)?.[0].length || 1;
    const remainder = specifier.slice(level).replace(/^\./, "");

    const fromModule = stripExt(fromFile).replace(/\//g, ".");
    const parts = fromModule.split(".");
    const base = parts.slice(0, Math.max(0, parts.length - level));
    const full = [...base, ...(remainder ? remainder.split(".") : [])].filter(Boolean).join(".");
    return pyCandidates.get(full) || null;
  }

  return pyCandidates.get(specifier) || null;
}

function stripKnownJsExt(value: string): string {
  for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
    if (value.endsWith(ext)) {
      return value.slice(0, -ext.length);
    }
  }
  return value;
}
