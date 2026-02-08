import type { FileIndexEntry, LanguageBreakdown } from "../types.js";

const EXT_TO_LANGUAGE: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".rb": "Ruby",
  ".php": "PHP",
  ".swift": "Swift",
  ".c": "C/C++",
  ".cc": "C/C++",
  ".cpp": "C/C++",
  ".h": "C/C++",
  ".hpp": "C/C++",
  ".cs": "C#",
  ".sh": "Shell",
  ".md": "Markdown",
  ".yml": "YAML",
  ".yaml": "YAML",
  ".json": "JSON",
  ".toml": "TOML",
};

export function buildLanguageBreakdown(index: FileIndexEntry[]): LanguageBreakdown[] {
  const map = new Map<string, { count: number; bytes: number }>();
  for (const file of index) {
    const language = EXT_TO_LANGUAGE[file.ext] || (file.ext ? file.ext.toUpperCase().slice(1) : "Other");
    const prev = map.get(language) || { count: 0, bytes: 0 };
    prev.count += 1;
    prev.bytes += file.sizeBytes;
    map.set(language, prev);
  }

  return Array.from(map.entries())
    .map(([language, stats]) => ({ language, count: stats.count, bytes: stats.bytes }))
    .sort((a, b) => b.bytes - a.bytes);
}
