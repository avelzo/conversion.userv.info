import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Convertisseur HEIC local',
  description: 'Conversion HEIC vers JPG, PNG ou WEBP avec sauvegarde locale sur le serveur.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
