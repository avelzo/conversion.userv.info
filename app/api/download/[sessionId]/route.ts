import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { getMimeType, getSessionDir, isValidSessionId, readManifest, resolveWithin } from '@/lib/files';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    if (!isValidSessionId(sessionId)) {
      return NextResponse.json({ error: 'Session invalide.' }, { status: 400 });
    }

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

    const convertedDir = resolveWithin(getSessionDir(sessionId), 'converted');
    const filePath = resolveWithin(convertedDir, match.convertedName);
    const handle = await fs.open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const data = await handle.readFile().finally(() => handle.close());
    const inline = ['1', 'true'].includes(searchParams.get('inline') ?? '');

    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': getMimeType(match.format),
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${match.convertedName}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Téléchargement impossible.' }, { status: 500 });
  }
}
