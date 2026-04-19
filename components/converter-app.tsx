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

type UploadItem = {
  file: File;
  id: string;
};

type UploadProgressEvent =
  | { type: 'start'; total: number }
  | { type: 'progress'; index: number; total: number; filename: string }
  | { type: 'done'; sessionId: string; files: ConvertedItem[]; errors: { filename: string; error: string }[] }
  | { type: 'error'; error: string };

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
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [showCompletionModal, setShowCompletionModal] = useState(false);

  const totalSize = useMemo(
    () => files.reduce((acc, item) => acc + item.file.size, 0),
    [files]
  );

  const convertedMap = useMemo(
    () => new Map(converted.map((item) => [item.originalName, item] as const)),
    [converted]
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
    setProgress(0);
    setStatusMessage('Préparation de l’envoi…');
    setConverted([]);

    try {
      const formData = new FormData();
      files.forEach((entry) => formData.append('files', entry.file));
      formData.append('format', format);
      formData.append('quality', String(quality));
      if (sessionId) formData.append('sessionId', sessionId);

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/upload');
        xhr.responseType = 'text';

        let lastProcessedLength = 0;

        const parseStream = () => {
          const responseText = xhr.responseText;
          const chunk = responseText.slice(lastProcessedLength);
          lastProcessedLength = responseText.length;

          for (const rawLine of chunk.split('\n')) {
            const line = rawLine.trim();
            if (!line) continue;
            try {
              const event = JSON.parse(line) as UploadProgressEvent;
              if (event.type === 'start') {
                setStatusMessage(`Conversion de ${event.total} fichier(s)…`);
              }
              if (event.type === 'progress') {
                setProgress(Math.round(30 + (event.index / event.total) * 60));
                setStatusMessage(`Conversion de ${event.filename} (${event.index}/${event.total})`);
              }
              if (event.type === 'done') {
                setSessionId(event.sessionId);
                setConverted(event.files);
                setErrors(event.errors || []);
                setProgress(100);
                setStatusMessage('Conversion terminée');
                setShowCompletionModal(true);
              }
              if (event.type === 'error') {
                setServerError(event.error);
              }
            } catch {
              // ignore malformed partial lines
            }
          }
        };

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            setProgress(Math.round((event.loaded / event.total) * 20));
            setStatusMessage('Envoi des fichiers…');
          } else {
            setProgress(15);
          }
        };

        xhr.onprogress = parseStream;
        xhr.onreadystatechange = () => {
          if (xhr.readyState === XMLHttpRequest.DONE) {
            parseStream();
            if (xhr.status >= 400) {
              try {
                const lastLine = xhr.responseText.trim().split('\n').pop();
                const parsed = lastLine ? JSON.parse(lastLine) : null;
                const errorMessage = parsed?.error ?? 'Erreur serveur.';
                setServerError(errorMessage);
              } catch {
                setServerError('Erreur serveur.');
              }
            }
          }
        };

        xhr.onerror = () => reject(new Error('Erreur de connexion lors de la conversion.'));
        xhr.onloadend = () => resolve();
        xhr.send(formData);
      });
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Erreur inconnue.');
      setProgress(0);
      setStatusMessage(null);
    } finally {
      setLoading(false);
      if (!serverError && progress !== 100) {
        setProgress(100);
      }
    }
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (loading) return;
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
    setProgress(0);
    setStatusMessage(null);
    setShowCompletionModal(false);
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
              if (!loading) setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <div className="actions">
              <button className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={loading}>
                Sélectionner des images HEIC
              </button>
              <button className="btn btn-secondary" onClick={resetAll} disabled={loading || (!files.length && !converted.length)}>
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
              disabled={loading}
            />

            <p className="helper" style={{ marginTop: 16 }}>
              Drag & drop pris en charge. Les fichiers non HEIC/HEIF sont ignorés.
            </p>
          </div>

          <div className="list">
            {files.map((item) => {
              const convertedItem = convertedMap.get(item.file.name);
              const thumbnailUrl =
                convertedItem && sessionId
                  ? `/api/download/${sessionId}?file=${encodeURIComponent(convertedItem.convertedName)}&inline=1`
                  : undefined;

              return (
                <div key={item.id} className="item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <strong>{item.file.name}</strong>
                    <small>{formatBytes(item.file.size)}</small>
                  </div>

                  {convertedItem && (
                    <img
                      src={thumbnailUrl}
                      alt={`Aperçu de ${convertedItem.convertedName}`}
                      style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb' }}
                    />
                  )}

                  <div className="actions" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {convertedItem ? (
                      <a className="btn btn-primary" href={convertedItem.downloadUrl} download>
                        Télécharger
                      </a>
                    ) : 
                      <span className={`status ${convertedItem ? 'done' : 'ready'}`}>
                        {`Prêt`}
                      </span>
                    }
                    <button className="btn btn-secondary" onClick={() => removeFile(item.id)} disabled={loading}>
                      Retirer
                    </button>
                  </div>
                </div>
              );
            })}
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
                  disabled={loading}
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
                  disabled={loading || format === 'png'}
                />
                <p className="helper">
                  Le réglage est surtout utile pour JPG et WEBP. Pour PNG, la compression reste sans perte.
                </p>
              </div>
            </div>

            <div className="actions" style={{ marginTop: 20, flexDirection: 'column', gap: 12 }}>
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

            {progress > 0 && (
              <div style={{ marginTop: 16 }}>
                <label htmlFor="conversion-progress" className="helper" style={{ display: 'block', marginBottom: 8 }}>
                  {statusMessage ?? 'Progression de la conversion'}
                </label>
                <progress id="conversion-progress" className="progress" max={100} value={progress} />
                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{progress}%</span>
                  <span>{loading ? 'Conversion en cours' : 'Prêt'}</span>
                </div>
              </div>
            )}

            {serverError && <p className="error">{serverError}</p>}

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
            </div>

            {errors.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div className="section-title">Erreurs</div>
                <div className="list">
                  {errors.map((errorItem) => (
                    <div key={errorItem.filename} className="item">
                      <div>
                        <strong>{errorItem.filename}</strong>
                        <small>{errorItem.error}</small>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </aside>
      </div>

      {showCompletionModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowCompletionModal(false)}
        >
          <div
            className="card panel"
            style={{
              maxWidth: 400,
              margin: 20,
              textAlign: 'center',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginBottom: 16, color: '#10b981' }}>✅ Conversion terminée !</h2>
            <p style={{ marginBottom: 24 }}>
              Toutes vos images HEIC ont été converties avec succès.
              Vous pouvez maintenant les télécharger individuellement ou en ZIP.
            </p>
            <button
              className="btn btn-primary"
              onClick={() => setShowCompletionModal(false)}
              style={{ width: '100%' }}
            >
              OK
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
