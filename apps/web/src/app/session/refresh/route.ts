import { NextResponse } from 'next/server';
import { refreshSession } from '@/lib/api';

// The one place a session is renewed: only route handlers and server actions can set cookies, and pages get here
// through proxy.ts (access cookie gone) or api() (token refused). The session's parallel requests may all arrive
// here with one refresh token, and all get the same next one.
export async function GET(request: Request): Promise<Response> {
  const next = new URL(request.url).searchParams.get('next') ?? '/';
  // Paths on this site only: the value comes from the link, and this must not redirect elsewhere.
  const local = /^\/(?![/\\])/.test(next) ? next : '/';
  return NextResponse.redirect(new URL((await refreshSession()) ? local : '/login', request.url));
}
