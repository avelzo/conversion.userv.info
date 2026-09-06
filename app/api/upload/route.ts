import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import convert from 'heic-convert';
import sharp from 'sharp';
import {
  createSessionFolders,
  ensureStorageCapacity,
  getMimeType,
  purgeOldSessions,
  replaceExt,
  resolveWithin,
  sanitizeFilename,
  StorageCapacityError,
  type ConvertedFileRecord,
  type OutputFormat,
  writeManifest,
} from '@/lib/files';
import {
  MAX_FILES_PER_REQUEST,
  MAX_FILE_SIZE,
  MAX_CONCURRENT_UPLOADS,
  MAX_OUTPUT_FILE_SIZE,
  MAX_REQUEST_SIZE,
  MAX_TOTAL_OUTPUT_SIZE,
  MAX_TOTAL_SIZE,
  readLimitedFormData,
  RequestTooLargeError,
  validateHeic,
} from '@/lib/upload-validation';

export const runtime = 'nodejs';

const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
let activeUploads = 0;

function clampQuality(value: number) {
  if (!Number.isFinite(value)) return 85;
  return Math.max(1, Math.min(100, Math.round(value)));
}

function uniqueFilename(filename: string, outputFormat: OutputFormat, usedOutputNames: Set<string>) {
  const parsed = path.parse(filename);
  let candidate = filename;
  let suffix = 2;

  while (usedOutputNames.has(replaceExt(candidate, outputFormat).toLowerCase())) {
    candidate = `${parsed.name}-${suffix}${parsed.ext}`;
    suffix += 1;
  }
  usedOutputNames.add(replaceExt(candidate, outputFormat).toLowerCase());
  return candidate;
}

async function convertHeic(buffer: Buffer, format: OutputFormat, quality: number) {
  if (format === 'jpg' || format === 'png') {
    const converted = await convert({
      buffer,
      format: format === 'jpg' ? 'JPEG' : 'PNG',
      quality: quality / 100,
    });
    return Buffer.from(converted);
  }

  const intermediatePng = await convert({ buffer, format: 'PNG', quality: 1 });
  return sharp(Buffer.from(intermediatePng)).webp({ quality }).toBuffer();
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

  let formData: FormData;
  try {
    formData = await readLimitedFormData(request);
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return earlyResponse(NextResponse.json({ error: 'La requête dépasse la limite de 100 Mio.' }, { status: 413 }));
    }
    return earlyResponse(NextResponse.json({ error: 'Corps multipart invalide.' }, { status: 400 }));
  }

  const fileValues = formData.getAll('files');
  if (!fileValues.length || fileValues.some((value) => !(value instanceof File))) {
    return earlyResponse(NextResponse.json({ error: 'Aucun fichier valide reçu.' }, { status: 400 }));
  }
  const files = fileValues as File[];

  if (files.length > MAX_FILES_PER_REQUEST) {
    return earlyResponse(NextResponse.json({ error: `Maximum ${MAX_FILES_PER_REQUEST} fichiers par conversion.` }, { status: 413 }));
  }

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (files.some((file) => file.size > MAX_FILE_SIZE)) {
    return earlyResponse(NextResponse.json({ error: 'Chaque fichier est limité à 25 Mio.' }, { status: 413 }));
  }
  if (totalSize > MAX_TOTAL_SIZE) {
    return earlyResponse(NextResponse.json({ error: 'La taille totale est limitée à 100 Mio.' }, { status: 413 }));
  }

  const rawFormat = formData.get('format');
  const format = typeof rawFormat === 'string' ? rawFormat : 'jpg';
  if (!['jpg', 'png', 'webp'].includes(format)) {
    return earlyResponse(NextResponse.json({ error: 'Format de sortie invalide.' }, { status: 400 }));
  }
  const outputFormat = format as OutputFormat;
  const quality = clampQuality(Number(formData.get('quality') ?? 85));

  // Never use a client-controlled session ID in a filesystem path.
  let session: Awaited<ReturnType<typeof createSessionFolders>>;
  try {
    await purgeOldSessions(SESSION_MAX_AGE_MS);
    await ensureStorageCapacity(totalSize + MAX_TOTAL_OUTPUT_SIZE);
    session = await createSessionFolders();
  } catch (error) {
    if (error instanceof StorageCapacityError) {
      return earlyResponse(NextResponse.json({ error: 'Quota de stockage temporaire atteint.' }, { status: 507 }));
    }
    return earlyResponse(NextResponse.json({ error: 'Stockage temporaire indisponible.' }, { status: 500 }));
  }
  const { sessionId, sessionDir, originalDir, convertedDir } = session;
  const convertedFiles: ConvertedFileRecord[] = [];
  const errors: { filename: string; error: string }[] = [];
  const usedOutputNames = new Set<string>();
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
          const displayName = sanitizeFilename(file.name || `image-${index + 1}.heic`);
          const originalName = uniqueFilename(displayName, outputFormat, usedOutputNames);
          let originalPath: string | undefined;
          let convertedPath: string | undefined;

          try {
            if (!/\.(heic|heif)$/i.test(originalName)) {
              throw new Error('Extension non supportée. Utilise un fichier .heic ou .heif.');
            }

            const inputBuffer = Buffer.from(await file.arrayBuffer());
            await validateHeic(inputBuffer);

            originalPath = resolveWithin(originalDir, originalName);
            await fs.writeFile(originalPath, inputBuffer, { flag: 'wx', mode: 0o600 });

            const convertedName = replaceExt(originalName, outputFormat);
            convertedPath = resolveWithin(convertedDir, convertedName);
            const outputBuffer = await convertHeic(inputBuffer, outputFormat, quality);

            if (outputBuffer.length > MAX_OUTPUT_FILE_SIZE) {
              throw new Error('Le fichier converti dépasse la limite de 100 Mio.');
            }
            if (totalOutputSize + outputBuffer.length > MAX_TOTAL_OUTPUT_SIZE) {
              throw new Error('La taille totale des conversions dépasse la limite de 250 Mio.');
            }

            await fs.writeFile(convertedPath, outputBuffer, { flag: 'wx', mode: 0o600 });
            totalOutputSize += outputBuffer.length;
            convertedFiles.push({
              originalName,
              convertedName,
              originalPath,
              convertedPath,
              mimeType: getMimeType(outputFormat),
              format: outputFormat,
              size: outputBuffer.length,
              createdAt: new Date().toISOString(),
            });
          } catch (error) {
            await Promise.all([
              originalPath ? fs.rm(originalPath, { force: true }) : Promise.resolve(),
              convertedPath ? fs.rm(convertedPath, { force: true }) : Promise.resolve(),
            ]);
            errors.push({
              filename: displayName,
              error: error instanceof Error ? error.message : 'Conversion impossible.',
            });
          }

          write({ type: 'progress', index: index + 1, total: files.length, filename: displayName });
        }

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
