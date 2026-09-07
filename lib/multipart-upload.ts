import busboy from 'busboy';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolveWithin, sanitizeFilename } from './files.ts';
import {
  MAX_FILES_PER_REQUEST,
  MAX_FILE_SIZE,
  MAX_REQUEST_SIZE,
  MAX_TOTAL_SIZE,
} from './upload-validation.ts';

export type StreamedUpload = {
  originalName: string;
  originalPath: string;
  size: number;
};

export class MultipartUploadError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function uniqueInputFilename(filename: string, usedStems: Set<string>) {
  const parsed = path.parse(filename);
  let candidate = filename;
  let suffix = 2;

  while (usedStems.has(path.parse(candidate).name.toLowerCase())) {
    candidate = `${parsed.name}-${suffix}${parsed.ext}`;
    suffix += 1;
  }
  usedStems.add(path.parse(candidate).name.toLowerCase());
  return candidate;
}

export async function streamMultipartUpload(request: Request, originalDir: string) {
  if (!request.body) {
    throw new MultipartUploadError('Corps multipart invalide.');
  }

  let parser: ReturnType<typeof busboy>;
  try {
    parser = busboy({
      headers: Object.fromEntries(request.headers.entries()),
      limits: {
        fieldNameSize: 50,
        fieldSize: 100,
        fields: 2,
        fileSize: MAX_FILE_SIZE,
        files: MAX_FILES_PER_REQUEST,
        parts: MAX_FILES_PER_REQUEST + 3,
        headerPairs: 50,
      },
    });
  } catch {
    throw new MultipartUploadError('Corps multipart invalide.');
  }

  const fields = new Map<string, string>();
  const uploads: StreamedUpload[] = [];
  const writes: Promise<void>[] = [];
  const usedStems = new Set<string>();
  let parsingError: MultipartUploadError | undefined;
  let requestSize = 0;

  const rejectParsing = (message: string, status = 400) => {
    parsingError ??= new MultipartUploadError(message, status);
  };

  parser.on('field', (name, value, info) => {
    if (info.valueTruncated || !['format', 'quality'].includes(name)) {
      rejectParsing('Champ multipart invalide.');
      return;
    }
    fields.set(name, value);
  });

  parser.on('file', (fieldName, file, info) => {
    if (fieldName !== 'files') {
      rejectParsing('Champ fichier invalide.');
      file.resume();
      return;
    }

    const displayName = sanitizeFilename(info.filename || `image-${uploads.length + 1}.heic`);
    if (!/\.(heic|heif)$/i.test(displayName)) {
      rejectParsing('Extension non supportée. Utilise un fichier .heic ou .heif.');
      file.resume();
      return;
    }

    const originalName = uniqueInputFilename(displayName, usedStems);
    const originalPath = resolveWithin(originalDir, originalName);
    const upload = { originalName, originalPath, size: 0 };
    uploads.push(upload);

    const write = fs.createWriteStream(originalPath, { flags: 'wx', mode: 0o600 });
    let truncated = false;
    file.on('limit', () => {
      truncated = true;
    });
    file.on('data', (chunk: Buffer) => {
      upload.size += chunk.length;
    });

    const completedWrite = new Promise<void>((resolve, reject) => {
      file.once('error', reject);
      write.once('error', (error) => {
        file.resume();
        reject(error);
      });
      write.once('finish', () => {
        if (truncated || file.truncated) {
          reject(new MultipartUploadError('Chaque fichier est limité à 25 Mio.', 413));
        } else {
          resolve();
        }
      });
    }).catch((error) => {
      if (error instanceof MultipartUploadError) {
        rejectParsing(error.message, error.status);
      } else {
        rejectParsing('Écriture temporaire impossible.', 500);
      }
    });
    writes.push(completedWrite);
    file.pipe(write);
  });

  parser.on('filesLimit', () => rejectParsing(`Maximum ${MAX_FILES_PER_REQUEST} fichiers par conversion.`, 413));
  parser.on('fieldsLimit', () => rejectParsing('Trop de champs multipart.'));
  parser.on('partsLimit', () => rejectParsing('Trop de parties multipart.', 413));

  const byteLimit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      requestSize += chunk.length;
      if (requestSize > MAX_REQUEST_SIZE) {
        callback(new MultipartUploadError('La requête dépasse la limite de 100 Mio.', 413));
      } else {
        callback(null, chunk);
      }
    },
  });

  try {
    await pipeline(Readable.fromWeb(request.body as never), byteLimit, parser);
    await Promise.all(writes);
  } catch (error) {
    await Promise.all(uploads.map((upload) => fsp.rm(upload.originalPath, { force: true })));
    if (error instanceof MultipartUploadError) throw error;
    throw new MultipartUploadError('Upload multipart interrompu.');
  }

  if (parsingError) {
    throw parsingError;
  }
  if (!uploads.length) {
    throw new MultipartUploadError('Aucun fichier valide reçu.');
  }
  if (uploads.reduce((total, upload) => total + upload.size, 0) > MAX_TOTAL_SIZE) {
    throw new MultipartUploadError('La taille totale est limitée à 100 Mio.', 413);
  }

  return { fields, uploads };
}
