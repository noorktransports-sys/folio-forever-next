import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Folio Forever — Heirloom wedding albums & magazines',
    template: '%s | Folio Forever',
  },
  description:
    'Large-format wedding albums and wedding magazines. Upload your photos, Smart Auto-Layout designs every page, you approve each one, and we print it to last.',
  metadataBase: new URL(
    process.env.SITE_URL ?? 'https://folioforever.com',
  ),
  applicationName: 'Folio Forever',
  openGraph: {
    type: 'website',
    siteName: 'Folio Forever',
    locale: 'en_US',
    title: 'Folio Forever — Heirloom wedding albums & magazines',
    description:
      'Design your wedding album or magazine online, approve every page, and we print it to last.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Folio Forever — Heirloom wedding albums & magazines',
    description:
      'Design your wedding album or magazine online, approve every page, and we print it to last.',
  },
};

export const viewport = { themeColor: '#0e0c09' };

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
