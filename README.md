# Convertisseur HEIC local

Application Next.js simple pour convertir des images **HEIC/HEIF** vers **JPG**, **PNG** ou **WEBP** depuis une page d'accueil unique.

## Fonctionnalités

- Upload multiple de fichiers `.heic` / `.heif`
- Conversion vers `jpg`, `png` ou `webp`
- Sauvegarde temporaire sur disque dans `/var/tmp/conversion.userv.info/<sessionId>/`
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
- Le stockage temporaire est plafonné à 2 Gio, avec au moins 1 Gio d'espace libre conservé ; les sessions les plus anciennes sont supprimées en priorité.
- Les fichiers partiels sont supprimés en cas d'échec et les sessions âgées de plus de 12 heures sont purgées lors d'un nouvel upload et par une tâche cron horaire.

## Installation

```bash
npm install
npm run dev
```

Puis ouvre `http://localhost:3000`.

## Exploitation

La commande `npm run cleanup` supprime les sessions âgées de plus de 12 heures. En production, elle est exécutée chaque heure par la crontab du compte `deploy`.

Le proxy Nginx doit autoriser l'enveloppe multipart correspondant à la limite applicative :

```nginx
client_max_body_size 101m;
```

## Arborescence des uploads

```txt
/var/tmp/conversion.userv.info/
  <sessionId>/
    manifest.json
    original/
      image1.heic
    converted/
      image1.jpg
```

## Notes

- Le stockage est **local au serveur** qui héberge l'application, hors du dépôt, avec des permissions privées.
- Si tu veux écrire directement dans un dossier arbitraire du poste client via le navigateur, il faut passer par des APIs navigateur spécifiques et ce n'est pas fiable comme comportement universel. Cette version suit le modèle standard : upload vers l'app self-hostée, stockage local serveur, puis download.
