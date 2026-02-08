export function parsePythonImports(source: string): string[] {
  const found = new Set<string>();
  const lines = source.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const importMatch = /^import\s+(.+)$/.exec(trimmed);
    if (importMatch) {
      const modules = importMatch[1].split(",").map((part) => part.trim().split(/\s+as\s+/)[0]);
      for (const mod of modules) {
        if (mod) {
          found.add(mod);
        }
      }
      continue;
    }

    const fromMatch = /^from\s+([\.\w]+)\s+import\s+/.exec(trimmed);
    if (fromMatch?.[1]) {
      found.add(fromMatch[1]);
    }
  }

  return Array.from(found);
}
