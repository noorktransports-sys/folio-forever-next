/**
 * /api/admin/logout — clears the admin_session cookie.
 */

import { clearSessionCookie } from '@/lib/admin-auth';

export const runtime = 'edge';

export async function POST() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearSessionCookie(),
    },
  });
}
