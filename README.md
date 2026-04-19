# Convertisseur HEIC local

Application Next.js simple pour convertir des images **HEIC/HEIF** vers **JPG**, **PNG** ou **WEBP** depuis une page d'accueil unique.

## Fonctionnalités

- Upload multiple de fichiers `.heic` / `.heif`
- Conversion vers `jpg`, `png` ou `webp`
- Sauvegarde locale sur disque dans `uploads/<sessionId>/`
  - `original/`
  - `converted/`
  - `manifest.json`
- Téléchargement fichier par fichier
- Téléchargement de toutes les conversions dans un ZIP
- Interface simple avec drag & drop

## Installation

```bash
npm install
npm run dev
```

Puis ouvre `http://localhost:3000`.

## Arborescence des uploads

```txt
uploads/
  <sessionId>/
    manifest.json
    original/
      image1.heic
    converted/
      image1.jpg
```

## Notes

- Le stockage est **local au serveur** qui héberge l'application.
- Si tu veux écrire directement dans un dossier arbitraire du poste client via le navigateur, il faut passer par des APIs navigateur spécifiques et ce n'est pas fiable comme comportement universel. Cette version suit le modèle standard : upload vers l'app self-hostée, stockage local serveur, puis download.
