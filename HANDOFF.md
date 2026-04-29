# Folio & Forever — System Handoff

**Read this first if you're a new developer, a returning Jayvee, or pasting this into Claude after a month.** It covers what the system is, where every piece of data lives, what to do when something breaks, and what's still on the roadmap.

Last updated: 2026-04-29.

---

## Tl;dr (the 30-second version)

- Custom-built album-printing website at **folioforever.com**.
- Customers design wedding albums (cover + spreads), preview them, submit. Owner (Jayvee) sees orders in an admin dashboard.
- Built on **Next.js 15 + TypeScript** for the modern parts, **vanilla JavaScript** for the legacy spread builder (`public/js/album-builder.js`).
- Hosted on **Cloudflare Pages** (free tier covers all traffic for now). All data lives in **Cloudflare KV** (designs/orders) + **Cloudflare R2** (photos).
- Transactional email via **Resend**.
- Owner email: `noorktransports@gmail.com`. Sending email: `orders@folioforever.com`.
- Stripe payment is **not wired yet** — submit currently fires email-based orders only. Stripe integration is the top todo.

---

## Languages & frameworks

| What | Where | Notes |
|---|---|---|
| **TypeScript / TSX** | All `src/` files | Strict mode on, edge runtime |
| **JavaScript** | `public/js/album-builder.js` | Legacy ~1500-line module from the old WordPress build. Still does spread layout + photo dragging. |
| **CSS** | Plain `.css` files | No Tailwind — handwritten classes |
| **Next.js 15** | App Router | Server components for first paint, client components for interactivity |
| **`@cloudflare/next-on-pages`** | Build adapter | Compiles Next.js routes into Cloudflare Pages Functions |

---

## Where data lives

### Photos → Cloudflare R2

- **Bucket name:** `folioforever-photos`
- **Binding name in code:** `env.PHOTOS`
- **Key shape:** `designs/{designId}/{id}.{ext}`
- **Public read path:** `/api/photo/<full-key>` (proxies private R2 with light validation)
- **Retention:** ~60 days for drafts; submitted orders' photos persist as long as the design record (1 year)

### Designs & orders → Cloudflare KV

- **Namespace name:** `DESIGN_DRAFTS`
- **Namespace ID:** `325e972a22e749e2915d3ac0ce98eb6b`
- **Binding name in code:** `env.DESIGN_DRAFTS`

Keys inside the namespace:

| Key pattern | Contents | TTL |
|---|---|---|
| `<12-hex-token>` | One design (a single album) — JSON blob | 60 days for drafts; 365 days once submitted |
| `_orders_index_v1` | JSON array of every submitted order summary (admin dashboard reads this) | none |
| `_drafts_index_v1` | JSON array of recent saves that haven't been submitted ("leads") | none, capped at 200 entries |
| `_admin_session_*` | (reserved) | — |

**There is no D1 database.** Wrangler config has D1 declared but commented out. KV is enough for current scale; flip to D1 once you're past ~1000 orders/month.

### Code → GitHub

- **Repo:** `github.com/noorktransports-sys/folio-forever-next`
- **Local clone (Jayvee's machine):** `C:\Users\fufck\Documents\GitHub\folio-forever-next`
- **Push process:** GitHub Desktop → review changes → write summary → Commit to main → Push origin
- **Cloudflare auto-deploys from `main` branch** (~2 min from push to live)

---

## Environment / secrets

Set in Cloudflare Pages → folio-forever-next → Settings → Variables and Secrets → Production.

### Plaintext variables (not secret, also in `wrangler.toml`)

| Name | Value | Purpose |
|---|---|---|
| `SITE_URL` | `https://folioforever.com` | Used in email links + share URLs |
| `SITE_NAME` | `Folio & Forever` | Reserved for future branding |
| `DESIGN_RETENTION_DAYS` | `60` | Reference for KV TTLs |
| `MAX_UPLOAD_BYTES` | `31457280` (30 MB) | Hard cap on photo upload size |

### Encrypted secrets (sensitive, only in Cloudflare dashboard)

| Name | Purpose | Where to rotate |
|---|---|---|
| `RESEND_API_KEY` | Send emails via Resend | resend.com → API keys → revoke + recreate |
| `ADMIN_PASSWORD` | `/admin` dashboard login | Cloudflare dashboard → edit secret → save → trigger redeploy |

**Critical:** Cloudflare Pages env vars are **bound at deploy time**. After changing a secret, you MUST trigger a fresh deploy (push any commit) for the change to take effect.

---

## Domain & DNS

- **Primary domain:** `folioforever.com`
- **DNS provider:** Cloudflare (managed in same dashboard as the project)
- **`*.pages.dev` URL:** `folio-forever-next.pages.dev` (preview / fallback)
- Both URLs serve the same deployment.

---

## URL map (every page on the site)

### Public customer pages

| URL | What | File |
|---|---|---|
| `/` | Homepage | `src/app/page.tsx` |
| `/photographers` | Photographer-targeted landing page | `src/app/photographers/page.tsx` |
| `/design` | Album builder (spreads + cover step) | `src/app/design/page.tsx` |
| `/design?d=<token>` | Edit existing saved design | same as above |
| `/album/<token>` | Read-only album viewer (the share link) | `src/app/album/[token]/page.tsx` |

### Admin (password-gated)

| URL | What | File |
|---|---|---|
| `/admin` | Dashboard: stats + tabs + orders + drafts | `src/app/admin/page.tsx` |
| `/admin/orders/<token>` | Single order detail (photos, address, notes, status) | `src/app/admin/orders/[token]/page.tsx` |

### API routes (all edge runtime)

| URL | Method | Purpose |
|---|---|---|
| `/api/upload` | POST | Upload one photo to R2, return URL |
| `/api/photo/<...key>` | GET | Proxy a private R2 photo |
| `/api/designs` | POST | Save a design to KV, return share token |
| `/api/designs/<token>` | GET | Read a design back |
| `/api/notify-order` | POST | Send customer + owner email (mode: `save` or `order`) |
| `/api/submit-order` | POST | Lock design, write order, fire owner email |
| `/api/admin/login` | POST | Sets `admin_session` cookie |
| `/api/admin/logout` | POST | Clears cookie |
| `/api/admin/orders/<token>/status` | POST | Update order status (auth required) |
| `/api/admin/orders/<token>/notes` | POST | Update internal notes (auth required) |

---

## Customer journey (end-to-end)

1. Lands on `/design`. Email-gate modal asks for email + name (saved to localStorage `folio-customer-v1`).
2. Picks "I'll design it" → drops into spread builder.
3. Uploads photos via dropzone → photos hit `/api/upload` → stored in R2.
4. Drags photos into spread layouts. ~12 layouts available (full bleed, side by side, triptych, etc).
5. Clicks "Submit Order" in the navbar → transitions to cover step.
6. Designs cover: leather (6 colors) or photo cover, title text, subtitle, font (10 options), font size, position.
7. Clicks "Preview album →" → calls `previewAlbum()` which:
   - serializes everything (spreads + cover + customer)
   - POSTs to `/api/designs` (writes to KV with random 12-hex token)
   - redirects to `/album/<token>`
8. Album viewer opens with cover face. "Open Album" → spreads carousel.
9. Customer reviews. Quick-jump page numbers (bottom on desktop, side rail on mobile with press-and-slide).
10. Clicks "Submit album" → **shipping form modal** (recipient name, phone, full address, delivery notes).
11. Confirm submit → POST `/api/submit-order`:
    - mints `orderId` (e.g. `FF-A1B2C3-LMK7N9`)
    - writes design back to KV with `status='submitted'`, `submittedAt`, `shipping` fields
    - extends TTL to 1 year
    - appends entry to `_orders_index_v1`
    - removes entry from `_drafts_index_v1`
    - calls `/api/notify-order` in `mode: 'order'` → emails customer + owner with photo download links
12. Customer sees thank-you screen + 4-step status timeline.
13. Customer can revisit `/album/<token>` any time to see latest status (admin updates propagate live).

---

## Admin journey

1. Footer link "Admin" (or bookmark `/admin`) → password gate.
2. After login: dashboard with stat cards (Total / Pending / In progress / Delivered / Drafts / Paid (Stripe pending) / Revenue).
3. Tabs filter the orders table by status.
4. Click "View" on a row → order detail showing:
   - **Customer:** name, clickable email
   - **Album:** size, spreads, photo count
   - **Cover:** title + subtitle preview
   - **Status dropdown:** Pending → In progress → Shipped → Delivered → Cancelled (live, optimistic)
   - **Ship-to block:** full address, clickable phone, delivery notes
   - **Download all photos (.zip)** button → uses JSZip in-browser to bundle every photo into one ZIP named `<orderId>-photos.zip`
   - **Open customer preview ↗** → opens `/album/<token>` in a new tab
   - **Email customer** → mailto: with order ID prefilled
   - **Internal notes** textarea → auto-saves on blur or after 2s typing pause

---

## Email pipeline

- **Provider:** Resend (resend.com)
- **Sending domain:** `folioforever.com` (verified via Resend's Cloudflare-DNS auto-config)
- **From address:** `Folio & Forever <orders@folioforever.com>` (overridable via `ORDER_FROM_EMAIL` env var)
- **Owner address:** `noorktransports@gmail.com` (overridable via `OWNER_EMAIL` env var)

### Two email modes (single endpoint, `/api/notify-order`)

| Mode | Triggered when | Recipients |
|---|---|---|
| `save` | Customer hits Save & Share (or any save action) | Customer only — receipt with share link |
| `order` | Customer hits Submit album OR (future) Stripe webhook fires | Customer + owner — owner gets full order details + photo download URLs |

The Save flow intentionally never emails the owner so multiple iterations don't spam Jayvee with fake "new orders".

---

## Deploy process

1. Make edits locally in `C:\Users\fufck\Documents\GitHub\folio-forever-next`.
2. Open **GitHub Desktop**.
3. Review the diff in the left panel.
4. Write a clear commit summary at the bottom-left.
5. Click **Commit to main**.
6. Click **Push origin**.
7. Cloudflare auto-detects the push and starts a build (~2 min).
8. Live at `folioforever.com` once the deploy turns green.

### Cache-busting JavaScript

Cloudflare's CDN caches `/js/album-builder.js` with `max-age=14400` (4 hours). Browsers won't refetch within that window. To force a refetch:
- In `src/app/design/page.tsx`, the script tag has `?v=20260429-N`. **Bump the number every time you change `album-builder.js`.**
- Currently at `?v=20260429-9`.

---

## Common errors & how to fix them

### `admin not configured` on `/admin` login

- **Cause:** `ADMIN_PASSWORD` env var either isn't set, OR the live deploy is older than the variable (env vars are baked at deploy time, not live-loaded).
- **Fix:** Push any commit to trigger a fresh deploy.

### `Could not email...` on Save & Share or Submit

- **Cause:** Resend domain verification still pending, or `RESEND_API_KEY` not set, or sender address not on a verified domain.
- **Fix:** Check `resend.com/domains` — `folioforever.com` must show **Verified**.

### Browser shows old code after deploy

- **Cause:** Cloudflare CDN cached old `/js/album-builder.js`.
- **Fix:** Bump `?v=` query in `src/app/design/page.tsx`. Or hard refresh (Ctrl+Shift+R).

### TypeScript build fails on Cloudflare

- **Cause:** Type mismatch in TSX. Cloudflare runs `next build` in strict mode and rejects the deploy.
- **Fix:** Cloudflare → Workers & Pages → folio-forever-next → click failed deploy → View details → read the build log → fix the type → push again.

### Cover shows "Our Story" instead of customer's title

- **Cause:** The design was saved before cover-state mirroring was added (legacy data from early testing).
- **Fix:** Make a fresh design — new saves capture cover correctly.

### Edit button missing from album viewer

- **By design.** Once the album is submitted, Edit is replaced with "Request changes" (a mailto: link) so customers can't silently mutate orders that are already in production.

---

## What's pending (roadmap)

### Top priority
1. **Stripe payment.** Replace the current "submit → email" with "submit → Stripe Checkout → webhook → email". Three products to create in Stripe: Standard $149, Monument $229, Sample Kit $15. New routes: `/api/checkout`, `/api/stripe-webhook`. New page: `/order/success`.
2. **Cloudflare Access for `/admin`.** Right now `/admin` is password-protected (good for testing). Before launch, add Cloudflare Zero Trust → Access → Application → require Google sign-in. No code changes needed.
3. **Customer email on status change.** When admin moves order → "In progress" / "Shipped" / "Delivered", auto-fire an email so customers don't message asking.
4. **Print-ready spread PDFs.** Server-side render each spread as a 300dpi PDF the printer can use. Currently you have to recreate from photos manually.

### Nice-to-have, not urgent
- Abandoned-draft email follow-up (24h after save without submit)
- Customer reviews / testimonials section
- Photographer partner / reseller program (separate dashboard for pros)
- Inventory tracking (paper, leather stock) — overkill until ~50 orders/month
- Analytics: revenue + conversion funnel charts on admin dashboard

---

## Cheat sheet for "where is X"

| Thing | Where |
|---|---|
| Code | github.com/noorktransports-sys/folio-forever-next |
| Local clone | C:\Users\fufck\Documents\GitHub\folio-forever-next |
| Cloudflare account | noorktransports@gmail.com |
| Cloudflare project | folio-forever-next |
| KV namespace ID | 325e972a22e749e2915d3ac0ce98eb6b |
| KV namespace name | DESIGN_DRAFTS |
| R2 bucket | folioforever-photos |
| Resend account | noorktransports@gmail.com (Google OAuth login) |
| Resend domain | folioforever.com (verified) |
| Domain registrar | folioforever.com via Cloudflare |
| Owner inbox | noorktransports@gmail.com |
| Sending email | orders@folioforever.com |
| Admin URL | folioforever.com/admin |
| Admin password | (only Jayvee knows — set as Cloudflare secret) |

---

## Quick reference for "I'm pasting this back to Claude in a month"

If you're stuck and want me to help, paste this whole file plus a description of the problem. The doc tells me everything I need to know about the system. Then describe:
- What you tried to do
- What you saw instead
- Any error message you copy-pasted

I'll be able to pick up from here.

---

*Maintained by: Jayvee + Claude. Update this file whenever a new feature lands or an architectural decision changes.*
