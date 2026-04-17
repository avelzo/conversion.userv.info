import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readManifest, UPLOADS_ROOT } from '@/lib/files';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const { searchParams } = new URL(request.url);
    const file = searchParams.get('file');

    if (!file) {
      return NextResponse.json({ error: 'Fichier manquant.' }, { status: 400 });
    }

    const manifest = await readManifest(sessionId);
    const match = manifest.files.find((item) => item.convertedName === file);

    if (!match) {
      return NextResponse.json({ error: 'Fichier introuvable.' }, { status: 404 });
    }

    const filePath = path.join(UPLOADS_ROOT, sessionId, 'converted', match.convertedName);
    const data = await fs.readFile(filePath);

    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': match.mimeType,
        'Content-Disposition': `attachment; filename="${match.convertedName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Téléchargement impossible.' }, { status: 500 });
  }
}
