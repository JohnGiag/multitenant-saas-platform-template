import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';
import { CLERK } from '@/lib/auth-mode';

// Signed-out visitors to / get the landing page (/welcome); signed-in ones the dashboard's Overview.
function home(req: NextRequest, signedIn: boolean) {
  return req.nextUrl.pathname === '/' && !signedIn ? NextResponse.rewrite(new URL('/welcome', req.url)) : NextResponse.next();
}

// Clerk mode: reads and refreshes the Clerk session on every request, so auth() and getToken() work in pages,
// server actions and route handlers. Local mode only checks for our session cookie (`session`, lib/session.ts).
export default CLERK
  ? clerkMiddleware(async (auth, req) => home(req, (await auth()).userId !== null))
  : (req: NextRequest) => home(req, req.cookies.has('session'));

export const config = {
  matcher: [
    // Everything but Next.js internals and static files.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/__clerk/(.*)',
  ],
};
