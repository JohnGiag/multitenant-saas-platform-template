import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';
import { CLERK } from '@/lib/auth-mode';
import { PAGE_HEADER } from '@/lib/session-page';

// Signed-out visitors to / get the landing page (/welcome); signed-in ones the dashboard's Overview.
function home(req: NextRequest, signedIn: boolean) {
  if (req.nextUrl.pathname === '/' && !signedIn) return NextResponse.rewrite(new URL('/welcome', req.url));
  // Set here, whatever the browser sent: where api() sends the user back to after renewing a refused token.
  const headers = new Headers(req.headers);
  headers.set(PAGE_HEADER, req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

// The access cookie is gone but a session may live on: renewed before the page renders, since pages cannot set cookies.
// GET only: a redirect would drop a form post, whose action goes through api() instead.
function renew(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (req.method !== 'GET' || pathname.startsWith('/session/') || req.cookies.has('session') || !req.cookies.has('refresh')) return null;
  const url = new URL('/session/refresh', req.url);
  url.searchParams.set('next', pathname + search);
  return NextResponse.redirect(url);
}

// Clerk mode: reads and refreshes the Clerk session on every request, so auth() and getToken() work in pages,
// server actions and route handlers. Local mode checks for our cookies (`session` and `refresh`, lib/session.ts).
export default CLERK
  ? clerkMiddleware(async (auth, req) => home(req, (await auth()).userId !== null))
  : (req: NextRequest) => renew(req) ?? home(req, req.cookies.has('session'));

export const config = {
  matcher: [
    // Everything but Next.js internals and static files.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/__clerk/(.*)',
  ],
};
