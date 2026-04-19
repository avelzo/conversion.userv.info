import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import convert from 'heic-convert';
import sharp from 'sharp';
import {
  createSessionFolders,
  getMimeType,
  purgeOldSessions,
  replaceExt,
  sanitizeFilename,
  type ConvertedFileRecord,
  type OutputFormat,
  writeManifest,
} from '@/lib/files';

export const runtime = 'nodejs';

function clampQuality(value: number) {
  if (Number.isNaN(value)) return 85;
  return Math.max(1, Math.min(100, value));
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

  const intermediatePng = await convert({
    buffer,
    format: 'PNG',
    quality: 1,
  });

  return sharp(Buffer.from(intermediatePng)).webp({ quality }).toBuffer();
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    const format = (formData.get('format') as OutputFormat | null) ?? 'jpg';
    const quality = clampQuality(Number(formData.get('quality') ?? 85));
    const sessionId = (formData.get('sessionId') as string | null) ?? undefined;

    if (!files.length) {
      return NextResponse.json({ error: 'Aucun fichier reçu.' }, { status: 400 });
    }

    const validFormats: OutputFormat[] = ['jpg', 'png', 'webp'];
    if (!validFormats.includes(format)) {
      return NextResponse.json({ error: 'Format de sortie invalide.' }, { status: 400 });
    }

    await purgeOldSessions(12 * 60 * 60 * 1000);
    const { sessionId: resolvedSessionId, originalDir, convertedDir } = await createSessionFolders(sessionId);
    const convertedFiles: ConvertedFileRecord[] = [];
    const errors: { filename: string; error: string }[] = [];

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const write = async (payload: object) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        };

        await write({ type: 'start', total: files.length });

        for (let index = 0; index < files.length; index += 1) {
          const file = files[index];
          const originalName = sanitizeFilename(file.name || `image-${Date.now()}.heic`);
          const isHeic = /\.(heic|heif)$/i.test(originalName) || ['image/heic', 'image/heif'].includes(file.type);

          if (!isHeic) {
            errors.push({ filename: originalName, error: 'Format non supporté. Utilise un fichier .heic ou .heif.' });
            await write({ type: 'progress', index: index + 1, total: files.length, filename: originalName });
            continue;
          }

          try {
            const arrayBuffer = await file.arrayBuffer();
            const inputBuffer = Buffer.from(arrayBuffer);
            const originalPath = path.join(originalDir, originalName);
            await fs.writeFile(originalPath, inputBuffer);

            const convertedName = replaceExt(originalName, format);
            const convertedPath = path.join(convertedDir, convertedName);
            const outputBuffer = await convertHeic(inputBuffer, format, quality);
            await fs.writeFile(convertedPath, outputBuffer);

            convertedFiles.push({
              originalName,
              convertedName,
              originalPath,
              convertedPath,
              mimeType: getMimeType(format),
              format,
              size: outputBuffer.length,
              createdAt: new Date().toISOString(),
            });
            await write({ type: 'progress', index: index + 1, total: files.length, filename: originalName });
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Conversion impossible';
            errors.push({ filename: originalName, error: message });
            await write({ type: 'progress', index: index + 1, total: files.length, filename: originalName });
          }
        }

        await write({
          type: 'done',
          sessionId: resolvedSessionId,
          files: convertedFiles.map((item) => ({
            originalName: item.originalName,
            convertedName: item.convertedName,
            size: item.size,
            mimeType: item.mimeType,
            downloadUrl: `/api/download/${resolvedSessionId}?file=${encodeURIComponent(item.convertedName)}`,
          })),
          errors,
        });

        await writeManifest(resolvedSessionId, {
          sessionId: resolvedSessionId,
          createdAt: new Date().toISOString(),
          format,
          quality,
          files: convertedFiles,
        });

        controller.close();
      },
      cancel() {
        /* no-op */
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur serveur.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
