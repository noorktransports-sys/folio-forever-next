import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Folio & Forever — Heirloom wedding albums',
    template: '%s | Folio & Forever',
  },
  description:
    'Hand-bound, archival wedding albums for photographers and couples. Trade pricing for studios.',
  metadataBase: new URL(
    process.env.SITE_URL ?? 'https://folioforever.com',
  ),
};

/**
 * Root layout. Loads brand fonts from Google Fonts via <link> for now —
 * once a final domain is set we can switch to next/font for self-hosting
 * and remove the external request.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=Montserrat:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
