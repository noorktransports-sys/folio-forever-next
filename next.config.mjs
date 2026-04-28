// @ts-check

/**
 * Next.js config tuned for Cloudflare Pages via @cloudflare/next-on-pages.
 *
 * Notes:
 * - Image optimization is handled at the edge by Cloudflare; we use unoptimized
 *   loaders for now to avoid Vercel-only Image Optimization API. Switch to
 *   Cloudflare Images later if desired.
 * - Output remains the default (Next.js server) — the next-on-pages adapter
 *   converts route handlers to Workers at build time.
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // We will serve photos from Google Drive (signed URLs) and static assets
    // from /public. Disable Next image optimization to keep Cloudflare bundle
    // small; revisit once volume justifies Cloudflare Images.
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'drive.google.com' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};

export default nextConfig;
