import { refreshSession } from '@/lib/api';
import { localPath } from '@/lib/session-page';

// The one place a session is renewed: only route handlers and server actions can set cookies, and pages get here
// through proxy.ts (access cookie gone) or api() (token refused). The session's parallel requests may all arrive
// here with one refresh token, and all get the same next one.
export async function GET(request: Request): Promise<Response> {
  const next = new URL(request.url).searchParams.get('next') ?? '/';
  // A relative redirect: behind a proxy request.url holds the address this server binds to, not the site's.
  return new Response(null, { status: 307, headers: { location: (await refreshSession()) ? localPath(next) : '/login' } });
}
