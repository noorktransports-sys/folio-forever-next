import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Wedding magazine',
  description: 'Turn your wedding photos into a 20-page editorial-style magazine in one of ten original styles. Preview every page before you order.',
  alternates: { canonical: '/design/magazine' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
