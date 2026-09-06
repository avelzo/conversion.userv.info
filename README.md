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

## Sécurité et limites

- Les identifiants de session sont des UUID v4 générés exclusivement par le serveur.
- Le contenu HEIC/HEIF est vérifié (signature ISO BMFF, codec et dimensions), indépendamment du MIME envoyé par le navigateur.
- Limites : 20 fichiers, 25 Mio par fichier, 100 Mio par requête et 40 mégapixels par image.
- Une conversion produite est limitée à 100 Mio, et l'ensemble des sorties d'une requête à 250 Mio.
- Au plus deux requêtes de conversion sont traitées simultanément par processus serveur.
- Les fichiers partiels sont supprimés en cas d'échec et les sessions âgées de plus de 12 heures sont purgées lors d'un nouvel upload.

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
