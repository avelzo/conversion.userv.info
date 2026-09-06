import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const UPLOADS_ROOT = '/var/tmp/conversion.userv.info';
export const STORAGE_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;
export const MIN_FREE_STORAGE_BYTES = 1024 * 1024 * 1024;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class StorageCapacityError extends Error {}

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
  await fs.mkdir(dirPath, { recursive: true, mode: 0o700 });
}

export function isValidSessionId(sessionId: string) {
  return SESSION_ID_PATTERN.test(sessionId);
}

export function getSessionDir(sessionId: string) {
  if (!isValidSessionId(sessionId)) {
    throw new Error('Invalid session ID');
  }

  return path.join(UPLOADS_ROOT, sessionId);
}

export function resolveWithin(parentDir: string, filename: string) {
  if (!filename || path.basename(filename) !== filename) {
    throw new Error('Invalid filename');
  }

  const resolvedParent = path.resolve(parentDir);
  const resolvedPath = path.resolve(parentDir, filename);
  if (!resolvedPath.startsWith(`${resolvedParent}${path.sep}`)) {
    throw new Error('Path escapes its parent directory');
  }

  return resolvedPath;
}

export async function createSessionFolders() {
  const resolvedSessionId = crypto.randomUUID();
  const sessionDir = path.join(UPLOADS_ROOT, resolvedSessionId);
  const originalDir = path.join(sessionDir, 'original');
  const convertedDir = path.join(sessionDir, 'converted');

  await ensureDir(originalDir);
  await ensureDir(convertedDir);

  return { sessionId: resolvedSessionId, sessionDir, originalDir, convertedDir };
}

export function sanitizeFilename(name: string) {
  const sanitized = path.basename(name)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');

  return sanitized || 'image.heic';
}

export function replaceExt(filename: string, ext: string) {
  const parsed = path.parse(filename);
  return `${parsed.name}.${ext}`;
}

export const MANIFEST_FILE = 'manifest.json';

export async function writeManifest(sessionId: string, manifest: SessionManifest) {
  const sessionDir = getSessionDir(sessionId);
  await ensureDir(sessionDir);
  const manifestPath = resolveWithin(sessionDir, MANIFEST_FILE);
  const temporaryPath = resolveWithin(sessionDir, `${MANIFEST_FILE}.tmp`);
  await fs.writeFile(temporaryPath, JSON.stringify(manifest, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  await fs.rename(temporaryPath, manifestPath);
}

export async function purgeOldSessions(maxAgeMs: number) {
  await ensureDir(UPLOADS_ROOT);
  const entries = await fs.readdir(UPLOADS_ROOT, { withFileTypes: true });
  const now = Date.now();
  let purgedSessions = 0;

  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidSessionId(entry.name)) continue;
    const sessionDir = path.join(UPLOADS_ROOT, entry.name);

    try {
      const stats = await fs.stat(sessionDir);
      const age = now - Math.max(stats.mtimeMs, stats.ctimeMs);
      if (age > maxAgeMs) {
        await fs.rm(sessionDir, { recursive: true, force: true });
        purgedSessions += 1;
      }
    } catch {
      // ignore permission or race conditions
    }
  }

  return purgedSessions;
}

async function getDirectorySize(dirPath: string): Promise<number> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  let size = 0;

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      size += await getDirectorySize(entryPath);
    } else if (entry.isFile()) {
      size += (await fs.stat(entryPath)).size;
    }
  }

  return size;
}

export async function ensureStorageCapacity(reservedBytes = 0) {
  if (!Number.isSafeInteger(reservedBytes) || reservedBytes < 0) {
    throw new StorageCapacityError('Invalid storage reservation');
  }

  await ensureDir(UPLOADS_ROOT);
  const entries = await fs.readdir(UPLOADS_ROOT, { withFileTypes: true });
  const sessions: { path: string; size: number; updatedAt: number }[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidSessionId(entry.name)) continue;
    const sessionPath = getSessionDir(entry.name);
    try {
      const stats = await fs.stat(sessionPath);
      sessions.push({
        path: sessionPath,
        size: await getDirectorySize(sessionPath),
        updatedAt: Math.max(stats.mtimeMs, stats.ctimeMs),
      });
    } catch {
      // Ignore sessions concurrently removed by another cleanup or request.
    }
  }

  sessions.sort((left, right) => left.updatedAt - right.updatedAt);
  let storedBytes = sessions.reduce((total, session) => total + session.size, 0);
  const fileSystem = await fs.statfs(UPLOADS_ROOT);
  let freeBytes = Number(fileSystem.bavail) * Number(fileSystem.bsize);
  let purgedSessions = 0;

  for (const session of sessions) {
    const quotaExceeded = storedBytes + reservedBytes > STORAGE_QUOTA_BYTES;
    const freeSpaceLow = freeBytes < reservedBytes + MIN_FREE_STORAGE_BYTES;
    if (!quotaExceeded && !freeSpaceLow) break;

    await fs.rm(session.path, { recursive: true, force: true });
    storedBytes -= session.size;
    freeBytes += session.size;
    purgedSessions += 1;
  }

  if (
    storedBytes + reservedBytes > STORAGE_QUOTA_BYTES ||
    freeBytes < reservedBytes + MIN_FREE_STORAGE_BYTES
  ) {
    throw new StorageCapacityError('Insufficient temporary storage capacity');
  }

  return { purgedSessions, storedBytes, freeBytes };
}

export async function readManifest(sessionId: string): Promise<SessionManifest> {
  const sessionDir = getSessionDir(sessionId);
  const manifestPath = resolveWithin(sessionDir, MANIFEST_FILE);
  const raw = await fs.readFile(manifestPath, 'utf-8');
  const manifest = JSON.parse(raw) as SessionManifest;

  if (
    !manifest ||
    manifest.sessionId !== sessionId ||
    !['jpg', 'png', 'webp'].includes(manifest.format) ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error('Invalid session manifest');
  }

  for (const file of manifest.files) {
    if (
      !file ||
      typeof file.convertedName !== 'string' ||
      !['jpg', 'png', 'webp'].includes(file.format)
    ) {
      throw new Error('Invalid session manifest');
    }
    resolveWithin(path.join(sessionDir, 'converted'), file.convertedName);
  }

  return manifest;
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
