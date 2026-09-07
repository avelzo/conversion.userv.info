import { NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import {
  createSessionFolders,
  ensureDir,
  ensureStorageCapacity,
  getMimeType,
  purgeOldSessions,
  replaceExt,
  resolveWithin,
  StorageCapacityError,
  type ConvertedFileRecord,
  type OutputFormat,
  writeManifest,
} from '@/lib/files';
import { MultipartUploadError, streamMultipartUpload } from '@/lib/multipart-upload';
import {
  MAX_CONCURRENT_UPLOADS,
  MAX_OUTPUT_FILE_SIZE,
  MAX_REQUEST_SIZE,
  MAX_TOTAL_OUTPUT_SIZE,
  MAX_TOTAL_SIZE,
  validateHeicFile,
} from '@/lib/upload-validation';

export const runtime = 'nodejs';

const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const CONVERSION_TIMEOUT_SECONDS = 60;
const execFileAsync = promisify(execFile);
let activeUploads = 0;

function clampQuality(value: number) {
  if (!Number.isFinite(value)) return 85;
  return Math.max(1, Math.min(100, Math.round(value)));
}

async function convertHeicFile(
  inputPath: string,
  outputPath: string,
  sessionDir: string,
  format: OutputFormat,
  quality: number
) {
  const workDir = path.join(sessionDir, 'work', crypto.randomUUID());
  await ensureDir(workDir);
  const decoderFormat = format === 'jpg' ? 'jpg' : 'png';
  const decoderOutput = path.join(workDir, `result.${decoderFormat}`);
  const decoderOptions = decoderFormat === 'jpg'
    ? ['--quality', String(quality)]
    : ['--png-compression-level', '9'];

  try {
    await execFileAsync('/usr/bin/heif-convert', [
      '--quiet',
      '--codec-threads',
      '2',
      ...decoderOptions,
      inputPath,
      decoderOutput,
    ], {
      timeout: CONVERSION_TIMEOUT_SECONDS * 1000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    });

    if (format === 'webp') {
      await sharp(decoderOutput, { limitInputPixels: 40_000_000 })
        .webp({ quality })
        .timeout({ seconds: CONVERSION_TIMEOUT_SECONDS })
        .toFile(outputPath);
    } else {
      await fs.rename(decoderOutput, outputPath);
    }
    await fs.chmod(outputPath, 0o600);
  } catch {
    throw new Error('Décodage HEIC impossible ou délai dépassé.');
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_SIZE) {
    return NextResponse.json({ error: 'La requête dépasse la limite de 100 Mio.' }, { status: 413 });
  }

  if (activeUploads >= MAX_CONCURRENT_UPLOADS) {
    return NextResponse.json({ error: 'Le serveur traite déjà plusieurs conversions. Réessaie dans un instant.' }, { status: 429 });
  }
  activeUploads += 1;
  let released = false;
  const releaseUploadSlot = () => {
    if (!released) {
      released = true;
      activeUploads -= 1;
    }
  };
  const earlyResponse = (response: NextResponse) => {
    releaseUploadSlot();
    return response;
  };

  let session: Awaited<ReturnType<typeof createSessionFolders>>;
  try {
    await purgeOldSessions(SESSION_MAX_AGE_MS);
    await ensureStorageCapacity(MAX_TOTAL_SIZE + MAX_TOTAL_OUTPUT_SIZE);
    session = await createSessionFolders();
  } catch (error) {
    if (error instanceof StorageCapacityError) {
      return earlyResponse(NextResponse.json({ error: 'Quota de stockage temporaire atteint.' }, { status: 507 }));
    }
    return earlyResponse(NextResponse.json({ error: 'Stockage temporaire indisponible.' }, { status: 500 }));
  }

  const { sessionId, sessionDir, originalDir, convertedDir } = session;
  let parsedUpload: Awaited<ReturnType<typeof streamMultipartUpload>>;
  try {
    parsedUpload = await streamMultipartUpload(request, originalDir);
  } catch (error) {
    await fs.rm(sessionDir, { recursive: true, force: true });
    if (error instanceof MultipartUploadError) {
      return earlyResponse(NextResponse.json({ error: error.message }, { status: error.status }));
    }
    return earlyResponse(NextResponse.json({ error: 'Upload impossible.' }, { status: 400 }));
  }

  const rawFormat = parsedUpload.fields.get('format') ?? 'jpg';
  if (!['jpg', 'png', 'webp'].includes(rawFormat)) {
    await fs.rm(sessionDir, { recursive: true, force: true });
    return earlyResponse(NextResponse.json({ error: 'Format de sortie invalide.' }, { status: 400 }));
  }
  const outputFormat = rawFormat as OutputFormat;
  const quality = clampQuality(Number(parsedUpload.fields.get('quality') ?? 85));
  const files = parsedUpload.uploads;
  const convertedFiles: ConvertedFileRecord[] = [];
  const errors: { filename: string; error: string }[] = [];
  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream({
    async start(controller) {
      const write = (payload: object) => {
        if (cancelled) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      try {
        write({ type: 'start', total: files.length });
        let totalOutputSize = 0;

        for (let index = 0; index < files.length; index += 1) {
          if (cancelled || request.signal.aborted) {
            throw new Error('Upload cancelled');
          }

          const file = files[index];
          const originalName = file.originalName;
          const originalPath = file.originalPath;
          const convertedName = replaceExt(originalName, outputFormat);
          const convertedPath = resolveWithin(convertedDir, convertedName);

          try {
            await validateHeicFile(originalPath);
            await convertHeicFile(originalPath, convertedPath, sessionDir, outputFormat, quality);
            const outputStats = await fs.stat(convertedPath);

            if (outputStats.size > MAX_OUTPUT_FILE_SIZE) {
              throw new Error('Le fichier converti dépasse la limite de 100 Mio.');
            }
            if (totalOutputSize + outputStats.size > MAX_TOTAL_OUTPUT_SIZE) {
              throw new Error('La taille totale des conversions dépasse la limite de 250 Mio.');
            }

            totalOutputSize += outputStats.size;
            convertedFiles.push({
              originalName,
              convertedName,
              mimeType: getMimeType(outputFormat),
              format: outputFormat,
              size: outputStats.size,
              createdAt: new Date().toISOString(),
            });
          } catch (error) {
            await Promise.all([
              fs.rm(originalPath, { force: true }),
              fs.rm(convertedPath, { force: true }),
            ]);
            errors.push({
              filename: originalName,
              error: error instanceof Error ? error.message : 'Conversion impossible.',
            });
          }

          write({ type: 'progress', index: index + 1, total: files.length, filename: originalName });
        }

        await fs.rm(path.join(sessionDir, 'work'), { recursive: true, force: true });
        await writeManifest(sessionId, {
          sessionId,
          createdAt: new Date().toISOString(),
          format: outputFormat,
          quality,
          files: convertedFiles,
        });

        write({
          type: 'done',
          sessionId,
          files: convertedFiles.map((item) => ({
            originalName: item.originalName,
            convertedName: item.convertedName,
            size: item.size,
            mimeType: item.mimeType,
            downloadUrl: `/api/download/${sessionId}?file=${encodeURIComponent(item.convertedName)}`,
          })),
          errors,
        });
        controller.close();
      } catch {
        await fs.rm(sessionDir, { recursive: true, force: true });
        if (!cancelled) {
          write({ type: 'error', error: 'La conversion a échoué.' });
          controller.close();
        }
      } finally {
        releaseUploadSlot();
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
