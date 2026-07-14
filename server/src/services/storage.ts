import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export type StoredOriginal = {
  provider: "local";
  storageKey: string;
  fileName: string;
  mimeType: string;
  size: number;
};

function safeSegment(value = "file") {
  return value
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90) || "file";
}

export async function saveOriginalFile({
  sourcePath,
  fileName,
  mimeType,
  documentId,
}: {
  sourcePath: string;
  fileName: string;
  mimeType: string;
  documentId?: string;
}): Promise<StoredOriginal> {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const id = safeSegment(documentId || crypto.randomUUID());
  const name = safeSegment(fileName || "medical-document");
  const baseDir = path.resolve(process.cwd(), "storage", "originals", yyyy, mm);
  await fs.mkdir(baseDir, { recursive: true });
  const storageKey = path.join("originals", yyyy, mm, `${id}-${name}`);
  const targetPath = path.resolve(process.cwd(), "storage", storageKey);
  await fs.copyFile(sourcePath, targetPath);
  const stat = await fs.stat(targetPath);

  return {
    provider: "local",
    storageKey,
    fileName: name,
    mimeType,
    size: stat.size,
  };
}
