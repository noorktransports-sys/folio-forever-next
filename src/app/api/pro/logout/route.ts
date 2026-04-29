/**
 * /api/pro/logout — clears the photographer session cookie.
 */

import { clearProSessionCookie } from '@/lib/photographer-auth';

export const runtime = 'edge';

export async function POST() {
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/pro/login',
      'Set-Cookie': clearProSessionCookie(),
    },
  });
}
