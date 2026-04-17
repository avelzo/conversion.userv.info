'use client';

import { useMemo, useRef, useState } from 'react';

type OutputFormat = 'jpg' | 'png' | 'webp';

type ConvertedItem = {
  originalName: string;
  convertedName: string;
  size: number;
  mimeType: string;
  downloadUrl: string;
};

type ApiResponse = {
  sessionId: string;
  format: OutputFormat;
  quality: number;
  files: ConvertedItem[];
  errors: { filename: string; error: string }[];
  error?: string;
};

type UploadItem = {
  file: File;
  id: string;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`;
}

export default function ConverterApp() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [format, setFormat] = useState<OutputFormat>('jpg');
  const [quality, setQuality] = useState(85);
  const [files, setFiles] = useState<UploadItem[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [converted, setConverted] = useState<ConvertedItem[]>([]);
  const [errors, setErrors] = useState<{ filename: string; error: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const totalSize = useMemo(
    () => files.reduce((acc, item) => acc + item.file.size, 0),
    [files]
  );

  function addFiles(selected: FileList | File[]) {
    const incoming = Array.from(selected)
      .filter((file) => /\.(heic|heif)$/i.test(file.name))
      .map((file) => ({ file, id: `${file.name}-${file.size}-${crypto.randomUUID()}` }));

    setFiles((prev) => {
      const next = [...prev];
      for (const item of incoming) {
        if (!next.some((existing) => existing.file.name === item.file.name && existing.file.size === item.file.size)) {
          next.push(item);
        }
      }
      return next;
    });
  }

  async function handleConvert() {
    if (!files.length) return;
    setLoading(true);
    setServerError(null);
    setErrors([]);

    try {
      const formData = new FormData();
      files.forEach((entry) => formData.append('files', entry.file));
      formData.append('format', format);
      formData.append('quality', String(quality));
      if (sessionId) formData.append('sessionId', sessionId);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = (await response.json()) as ApiResponse;

      if (!response.ok) {
        throw new Error(data.error || 'Conversion impossible.');
      }

      setSessionId(data.sessionId);
      setConverted(data.files);
      setErrors(data.errors || []);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Erreur inconnue.');
    } finally {
      setLoading(false);
    }
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer.files?.length) {
      addFiles(event.dataTransfer.files);
    }
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((item) => item.id !== id));
  }

  function resetAll() {
    setFiles([]);
    setConverted([]);
    setErrors([]);
    setServerError(null);
    setSessionId(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <main className="container">
      <div className="badge">HEIC → JPG / PNG / WEBP • Sauvegarde locale dans uploads/session-id</div>

      <div style={{ marginTop: 20 }} className="grid grid-2">
        <section className="card panel">
          <h1 className="title">Convertisseur HEIC local, rapide et prêt à héberger</h1>
          <p className="subtitle">
            Dépose un ou plusieurs fichiers HEIC/HEIF, choisis le format de sortie,
            puis télécharge chaque image convertie séparément ou un ZIP complet.
            Les originaux et les conversions sont enregistrés sur le disque local du serveur,
            dans <code>uploads/&lt;sessionId&gt;</code>.
          </p>

          <div
            className={`dropzone ${isDragging ? 'active' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <div className="actions">
              <button className="btn btn-primary" onClick={() => inputRef.current?.click()}>
                Sélectionner des images HEIC
              </button>
              <button className="btn btn-secondary" onClick={resetAll} disabled={!files.length && !converted.length}>
                Réinitialiser
              </button>
            </div>

            <input
              ref={inputRef}
              hidden
              type="file"
              accept=".heic,.heif,image/heic,image/heif"
              multiple
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
              }}
            />

            <p className="helper" style={{ marginTop: 16 }}>
              Drag & drop pris en charge. Les fichiers non HEIC/HEIF sont ignorés.
            </p>
          </div>

          <div className="list">
            {files.map((item) => (
              <div key={item.id} className="item">
                <div>
                  <strong>{item.file.name}</strong>
                  <small>{formatBytes(item.file.size)}</small>
                </div>
                <div className="actions" style={{ justifyContent: 'flex-end' }}>
                  <span className="status ready">Prêt</span>
                  <button className="btn btn-secondary" onClick={() => removeFile(item.id)}>
                    Retirer
                  </button>
                </div>
              </div>
            ))}
            {!files.length && <p className="helper">Aucun fichier chargé pour le moment.</p>}
          </div>
        </section>

        <aside className="grid" style={{ gap: 20 }}>
          <section className="card panel">
            <div className="section-title">Réglages</div>
            <div className="meta">
              <div>
                <label htmlFor="format">Format de sortie</label>
                <select
                  id="format"
                  className="select"
                  value={format}
                  onChange={(e) => setFormat(e.target.value as OutputFormat)}
                >
                  <option value="jpg">JPG</option>
                  <option value="png">PNG</option>
                  <option value="webp">WEBP</option>
                </select>
              </div>

              <div>
                <label htmlFor="quality">Qualité ({quality})</label>
                <input
                  id="quality"
                  className="input"
                  type="range"
                  min={1}
                  max={100}
                  value={quality}
                  onChange={(e) => setQuality(Number(e.target.value))}
                  disabled={format === 'png'}
                />
                <p className="helper">
                  Le réglage est surtout utile pour JPG et WEBP. Pour PNG, la compression reste sans perte.
                </p>
              </div>
            </div>

            <div className="actions" style={{ marginTop: 20 }}>
              <button className="btn btn-primary" onClick={handleConvert} disabled={!files.length || loading}>
                {loading ? 'Conversion en cours…' : 'Convertir'}
              </button>
              <a
                className="btn btn-secondary"
                href={sessionId ? `/api/download-all/${sessionId}` : '#'}
                aria-disabled={!sessionId || !converted.length}
                style={{ pointerEvents: sessionId && converted.length ? 'auto' : 'none', opacity: sessionId && converted.length ? 1 : 0.55 }}
              >
                Télécharger tout en ZIP
              </a>
            </div>

            <p className="footer-note">
              Dossier serveur : <code>uploads/{sessionId ?? 'future-session-id'}</code>
            </p>
          </section>

          <section className="card panel">
            <div className="section-title">Résumé</div>
            <div className="stat-box">
              <div className="stat">
                Fichiers
                <strong>{files.length}</strong>
              </div>
              <div className="stat">
                Taille totale
                <strong>{formatBytes(totalSize)}</strong>
              </div>
              <div className="stat">
                Convertis
                <strong>{converted.length}</strong>
              </div>
            </div>

            {serverError && <p className="status error" style={{ marginTop: 16 }}>{serverError}</p>}
            {!!errors.length && (
              <div style={{ marginTop: 16 }}>
                {errors.map((entry) => (
                  <p key={`${entry.filename}-${entry.error}`} className="helper" style={{ color: '#fecaca' }}>
                    {entry.filename} : {entry.error}
                  </p>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>

      <section className="card panel" style={{ marginTop: 20 }}>
        <div className="section-title">Fichiers convertis</div>
        <div className="list">
          {converted.map((item) => (
            <div key={item.downloadUrl} className="item">
              <div>
                <strong>{item.convertedName}</strong>
                <small>Source : {item.originalName} • {formatBytes(item.size)}</small>
              </div>
              <div className="actions" style={{ justifyContent: 'flex-end' }}>
                <span className="status done">Terminé</span>
                <a className="btn btn-secondary" href={item.downloadUrl}>
                  Télécharger
                </a>
              </div>
            </div>
          ))}
          {!converted.length && <p className="helper">Les images converties apparaîtront ici après traitement.</p>}
        </div>
      </section>
    </main>
  );
}
