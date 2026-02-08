export function parseTsImports(source: string): string[] {
  const found = new Set<string>();

  const fromRegex = /\bimport\s+(?:type\s+)?[\s\S]*?\sfrom\s+["']([^"']+)["']/g;
  const sideEffectRegex = /\bimport\s+["']([^"']+)["']/g;
  const requireRegex = /\brequire\(\s*["']([^"']+)["']\s*\)/g;
  const dynamicRegex = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

  for (const regex of [fromRegex, sideEffectRegex, requireRegex, dynamicRegex]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source)) !== null) {
      if (match[1]) {
        found.add(match[1]);
      }
    }
  }

  return Array.from(found);
}
