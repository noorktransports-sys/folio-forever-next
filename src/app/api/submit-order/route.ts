/**
 * POST /api/submit-order — RETIRED.
 *
 * This was the old "manual builder" submit: it created orders with no
 * payment step (and anyone holding a draft token could trigger owner
 * emails). All ordering now goes through /design/smart (albums) and
 * /design/magazine, which save a priced order and take payment via
 * Square. Kept as a stub so old pages get a clear message.
 */

export const runtime = 'edge';

export async function POST() {
  return new Response(
    JSON.stringify({ error: 'Ordering has moved — please order in the album designer at /design/smart' }),
    { status: 410, headers: { 'Content-Type': 'application/json' } },
  );
}
