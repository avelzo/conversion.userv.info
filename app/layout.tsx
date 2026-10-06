import './globals.css';
import type { Metadata } from 'next';
import AnalyticsConsent from '@/components/AnalyticsConsent';

export const metadata: Metadata = {
  title: 'Convertisseur HEIC local',
  description: 'Conversion HEIC vers JPG, PNG ou WEBP avec sauvegarde locale sur le serveur.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const gaId = process.env.NEXT_PUBLIC_GA4_ID;

  return (
    <html lang="fr">
      <body>
        <AnalyticsConsent gaId={gaId} />
        {children}
      </body>
    </html>
  );
}
