import { NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';
import archiver from 'archiver';
import { readManifest, UPLOADS_ROOT } from '@/lib/files';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const manifest = await readManifest(sessionId);

    const stream = new ReadableStream({
      start(controller) {
        const archive = archiver('zip', { zlib: { level: 9 } });

        archive.on('data', (chunk) => controller.enqueue(chunk));
        archive.on('end', () => controller.close());
        archive.on('error', (error) => controller.error(error));

        for (const item of manifest.files) {
          const fullPath = path.join(UPLOADS_ROOT, sessionId, 'converted', item.convertedName);
          if (fs.existsSync(fullPath)) {
            archive.file(fullPath, { name: item.convertedName });
          }
        }

        archive.finalize().catch((error) => controller.error(error));
      },
      cancel() {
        // no-op
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="converted-${sessionId}.zip"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Archive ZIP indisponible.' }, { status: 500 });
  }
}
