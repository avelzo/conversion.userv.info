import sharp, { type Metadata } from 'sharp';

export const MAX_FILES_PER_REQUEST = 20;
export const MAX_FILE_SIZE = 25 * 1024 * 1024;
export const MAX_TOTAL_SIZE = 100 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MAX_REQUEST_SIZE = MAX_TOTAL_SIZE + 1024 * 1024;
export const MAX_OUTPUT_FILE_SIZE = 100 * 1024 * 1024;
export const MAX_TOTAL_OUTPUT_SIZE = 250 * 1024 * 1024;
export const MAX_CONCURRENT_UPLOADS = 2;

export class RequestTooLargeError extends Error {}

export async function readLimitedFormData(request: Request) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;') || !request.body) {
    throw new Error('Invalid multipart body');
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedSize = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      receivedSize += value.byteLength;
      if (receivedSize > MAX_REQUEST_SIZE) {
        throw new RequestTooLargeError('Request body too large');
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }

  const body = new Uint8Array(Buffer.concat(chunks, receivedSize));
  return new Response(body, { headers: { 'Content-Type': contentType } }).formData();
}

const HEIC_BRANDS = new Set([
  'heic', 'heix', 'hevc', 'hevx',
  'heim', 'heis', 'hevm', 'hevs',
]);

export function hasHeicSignature(buffer: Buffer) {
  if (buffer.length < 16 || buffer.toString('ascii', 4, 8) !== 'ftyp') {
    return false;
  }

  const boxSize = buffer.readUInt32BE(0);
  if (boxSize < 16 || boxSize > buffer.length) {
    return false;
  }

  for (let offset = 8; offset + 4 <= boxSize; offset += 4) {
    if (HEIC_BRANDS.has(buffer.toString('ascii', offset, offset + 4))) {
      return true;
    }
  }

  return false;
}

export async function validateHeic(buffer: Buffer) {
  if (!hasHeicSignature(buffer)) {
    throw new Error('Le contenu du fichier n’est pas une image HEIC/HEIF valide.');
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
  } catch {
    throw new Error('Le fichier HEIC/HEIF est invalide ou dépasse la taille d’image autorisée.');
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (metadata.format !== 'heif' || metadata.compression !== 'hevc' || width <= 0 || height <= 0) {
    throw new Error('Le contenu du fichier n’est pas une image HEIC/HEIF valide.');
  }

  if (width * height > MAX_IMAGE_PIXELS) {
    throw new Error('L’image dépasse la limite de 40 mégapixels.');
  }
}
