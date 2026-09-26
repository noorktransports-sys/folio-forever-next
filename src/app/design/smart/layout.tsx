import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Design your wedding album',
  description: 'Upload your wedding photos and Smart Auto-Layout designs every spread. Approve each page, then we print your heirloom album.',
  alternates: { canonical: '/design/smart' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
