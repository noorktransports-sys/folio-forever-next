/**
 * POST /api/notify-order — RETIRED.
 *
 * It let anyone send an email from orders@folioforever.com to any
 * address (the recipient came from the request). Order emails are now
 * sent only by the submit routes and the Square webhook.
 */

export const runtime = 'edge';

export async function POST() {
  return new Response(JSON.stringify({ error: 'Not available' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
  });
}
