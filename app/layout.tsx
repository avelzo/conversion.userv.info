import './globals.css';
import type { Metadata } from 'next';
import Script from 'next/script';

export const metadata: Metadata = {
  title: 'Convertisseur HEIC local',
  description: 'Conversion HEIC vers JPG, PNG ou WEBP avec sauvegarde locale sur le serveur.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const gaId = process.env.NEXT_PUBLIC_GA4_ID;

  return (
    <html lang="fr">
      <body>
        {gaId ? (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
              strategy="afterInteractive"
            />
            <Script id="google-analytics" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${gaId}');
              `}
            </Script>
          </>
        ) : null}
        {children}
      </body>
    </html>
  );
}
