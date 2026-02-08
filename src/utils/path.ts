import path from "node:path";

export function toPosixPath(input: string): string {
  return input.split(path.sep).join("/");
}

export function relPosix(from: string, to: string): string {
  return toPosixPath(path.relative(from, to));
}

export function safeJoin(...parts: string[]): string {
  return path.normalize(path.join(...parts));
}
