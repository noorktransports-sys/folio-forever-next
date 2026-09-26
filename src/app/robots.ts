import type { MetadataRoute } from 'next';

const SITE = 'https://folioforever.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/api/', '/album/', '/pro', '/design/smart/success', '/design/magazine/success'],
    },
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
