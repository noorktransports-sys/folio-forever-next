import type { MetadataRoute } from 'next';

const SITE = 'https://folioforever.com';

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: Array<[string, number]> = [
    ['/', 1],
    ['/design/smart', 0.9],
    ['/design/magazine', 0.9],
    ['/photographers', 0.6],
    ['/faq', 0.6],
    ['/shipping', 0.5],
    ['/refunds', 0.5],
    ['/terms', 0.3],
    ['/privacy', 0.3],
    ['/contact', 0.5],
  ];
  const lastModified = new Date('2026-09-26');
  return pages.map(([path, priority]) => ({ url: `${SITE}${path}`, lastModified, priority }));
}
