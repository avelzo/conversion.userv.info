import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  getSessionDir,
  isValidSessionId,
  resolveWithin,
  sanitizeFilename,
  UPLOADS_ROOT,
} from '../lib/files.ts';
import { streamMultipartUpload } from '../lib/multipart-upload.ts';
import { hasHeicSignature } from '../lib/upload-validation.ts';

test('only server-shaped UUID v4 session IDs are accepted', () => {
  const valid = 'b6945841-658e-452a-bf64-f8031052f9e7';
  assert.equal(isValidSessionId(valid), true);
  assert.equal(getSessionDir(valid), path.join(UPLOADS_ROOT, valid));

  for (const malicious of ['../outside', '..%2Foutside', '/tmp/outside', 'not-a-uuid']) {
    assert.equal(isValidSessionId(malicious), false);
    assert.throws(() => getSessionDir(malicious), /Invalid session ID/);
  }
});

test('resolved filenames cannot escape their parent directory', () => {
  assert.equal(resolveWithin('/tmp/conversion-test', 'photo.jpg'), '/tmp/conversion-test/photo.jpg');
  assert.throws(() => resolveWithin('/tmp/conversion-test', '../secret'), /Invalid filename/);
  assert.throws(() => resolveWithin('/tmp/conversion-test', '/etc/passwd'), /Invalid filename/);
});

test('uploaded filenames are reduced to safe basenames', () => {
  assert.equal(sanitizeFilename('../../photo étrange.HEIC'), 'photo-etrange.HEIC');
  assert.equal(sanitizeFilename('..'), 'image.heic');
});

test('HEIC detection checks the ISO BMFF brands instead of the extension or MIME', () => {
  const heicHeader = Buffer.alloc(24);
  heicHeader.writeUInt32BE(24, 0);
  heicHeader.write('ftyp', 4, 'ascii');
  heicHeader.write('heic', 8, 'ascii');
  heicHeader.write('mif1', 16, 'ascii');

  assert.equal(hasHeicSignature(heicHeader), true);
  assert.equal(hasHeicSignature(Buffer.from('not really a HEIC file')), false);

  const avifHeader = Buffer.from(heicHeader);
  avifHeader.write('avif', 8, 'ascii');
  assert.equal(hasHeicSignature(avifHeader), false);
});

test('multipart files are streamed to disk without trusting a declared content length', async () => {
  const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'conversion-multipart-'));
  const input = new FormData();
  input.set('format', 'jpg');
  input.set('files', new File([Buffer.from('small body')], 'fake.heic'));
  const request = new Request('http://localhost/api/upload', { method: 'POST', body: input });
  request.headers.delete('content-length');

  try {
    const parsed = await streamMultipartUpload(request, temporaryDir);
    assert.equal(parsed.fields.get('format'), 'jpg');
    assert.equal(parsed.uploads[0].originalName, 'fake.heic');
    assert.equal(await fs.readFile(parsed.uploads[0].originalPath, 'utf8'), 'small body');
  } finally {
    await fs.rm(temporaryDir, { recursive: true, force: true });
  }
});
