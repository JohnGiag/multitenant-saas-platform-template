import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { CLERK } from '@/lib/auth-mode';

// Clerk mode: reads and refreshes the Clerk session on every request, so auth() and getToken() work in pages,
// server actions and route handlers. Local mode needs nothing here (and has no Clerk keys).
export default CLERK ? clerkMiddleware() : () => NextResponse.next();

export const config = {
  matcher: [
    // Everything but Next.js internals and static files.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/__clerk/(.*)',
  ],
};
