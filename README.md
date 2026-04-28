# Folio & Forever — Next.js + Cloudflare Pages

Successor to the WordPress child theme `folio-forever-child`. Same brand,
different stack: Next.js 15 (app router) deployed to Cloudflare Pages,
photos in Google Drive, orders/designs in Cloudflare D1, payments via
Stripe, client portal via Clerk.

## Stack

| Layer              | Tool                                 |
| ------------------ | ------------------------------------ |
| Framework          | Next.js 15 (app router)              |
| Hosting            | Cloudflare Pages (edge runtime)      |
| Database           | Cloudflare D1 (SQLite)               |
| Photo storage      | Google Drive (service account)       |
| Payments           | Stripe Checkout                      |
| Auth (portal only) | Clerk                                |
| Transactional mail | Resend                               |

## Local dev

```bash
npm install
cp .env.example .env.local   # fill secrets
npm run dev                  # http://localhost:3000
```

## Deploy preview to Cloudflare

```bash
npm run pages:build
npx wrangler pages deploy .vercel/output/static \
  --project-name folio-forever \
  --branch preview
```

## Project layout

```
src/
  app/
    layout.tsx        Root layout, fonts, metadata
    page.tsx          Homepage (placeholder; Task #2 ports the real one)
    globals.css       Brand tokens + reset
    photographers/    Trade page (Task #3)
    design/           Album designer (Task #4)
    portal/           Authed client portal (Task #7)
    api/
      upload/         Drive upload (Task #5)
      checkout/       Stripe session create (Task #6)
      stripe-webhook/ Stripe webhook handler (Task #6)
```

## Build status

Scaffold complete (Task #1). Pages and API routes land per the task list.
