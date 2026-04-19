import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const UPLOADS_ROOT = path.join(process.cwd(), 'uploads');

export type OutputFormat = 'jpg' | 'png' | 'webp';

export type ConvertedFileRecord = {
  originalName: string;
  convertedName: string;
  originalPath: string;
  convertedPath: string;
  mimeType: string;
  format: OutputFormat;
  size: number;
  createdAt: string;
};

export type SessionManifest = {
  sessionId: string;
  createdAt: string;
  format: OutputFormat;
  quality: number;
  files: ConvertedFileRecord[];
};

export async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function createSessionFolders(sessionId?: string) {
  const resolvedSessionId = sessionId ?? crypto.randomUUID();
  const sessionDir = path.join(UPLOADS_ROOT, resolvedSessionId);
  const originalDir = path.join(sessionDir, 'original');
  const convertedDir = path.join(sessionDir, 'converted');

  await ensureDir(originalDir);
  await ensureDir(convertedDir);

  return { sessionId: resolvedSessionId, sessionDir, originalDir, convertedDir };
}

export function sanitizeFilename(name: string) {
  return name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function replaceExt(filename: string, ext: string) {
  const parsed = path.parse(filename);
  return `${parsed.name}.${ext}`;
}

export const MANIFEST_FILE = 'manifest.json';

export async function writeManifest(sessionId: string, manifest: SessionManifest) {
  const sessionDir = path.join(UPLOADS_ROOT, sessionId);
  await ensureDir(sessionDir);
  await fs.writeFile(path.join(sessionDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf-8');
}

export async function purgeOldSessions(maxAgeMs: number) {
  const entries = await fs.readdir(UPLOADS_ROOT, { withFileTypes: true });
  const now = Date.now();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sessionDir = path.join(UPLOADS_ROOT, entry.name);

    try {
      const stats = await fs.stat(sessionDir);
      const age = now - Math.max(stats.mtimeMs, stats.ctimeMs);
      if (age > maxAgeMs) {
        await fs.rm(sessionDir, { recursive: true, force: true });
      }
    } catch {
      // ignore permission or race conditions
    }
  }
}

export async function readManifest(sessionId: string): Promise<SessionManifest> {
  const manifestPath = path.join(UPLOADS_ROOT, sessionId, MANIFEST_FILE);
  const raw = await fs.readFile(manifestPath, 'utf-8');
  return JSON.parse(raw) as SessionManifest;
}

export function getMimeType(format: OutputFormat) {
  if (format === 'jpg') return 'image/jpeg';
  if (format === 'png') return 'image/png';
  return 'image/webp';
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}
