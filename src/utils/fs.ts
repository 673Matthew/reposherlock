import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function readTextFileLimited(
  filePath: string,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    const toRead = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(toRead);
    const { bytesRead } = await handle.read(buffer, 0, toRead, 0);
    return {
      text: buffer.subarray(0, bytesRead).toString("utf8"),
      truncated: stat.size > maxBytes,
    };
  } finally {
    await handle.close();
  }
}

export interface CopyDirOptions {
  shouldSkip?: (srcPath: string, name: string, isDirectory: boolean) => boolean;
}

export async function copyDirRecursive(src: string, dest: string, options: CopyDirOptions = {}): Promise<void> {
  await ensureDir(dest);
  const entries = await fs.readdir(src, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      if (options.shouldSkip?.(src, entry.name, entry.isDirectory())) {
        return;
      }

      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await copyDirRecursive(srcPath, destPath, options);
      } else if (entry.isSymbolicLink()) {
        const link = await fs.readlink(srcPath);
        await fs.symlink(link, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }),
  );
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

export async function writeTextFile(filePath: string, text: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, text, "utf8");
}

export function isProbablyBinaryByExt(filePath: string): boolean {
  const binaryExt = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".pdf",
    ".zip",
    ".gz",
    ".tar",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".dll",
    ".so",
    ".dylib",
    ".exe",
    ".bin",
    ".class",
    ".jar",
    ".mp3",
    ".mp4",
    ".mov",
  ]);
  return binaryExt.has(path.extname(filePath).toLowerCase());
}

export async function commandExists(command: string): Promise<boolean> {
  const pathEnv = process.env.PATH || "";
  const dirs = pathEnv.split(path.delimiter);
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];

  for (const dir of dirs) {
    for (const ext of exts) {
      const fullPath = path.join(dir, `${command}${ext}`);
      if (fsSync.existsSync(fullPath)) {
        return true;
      }
    }
  }

  return false;
}
