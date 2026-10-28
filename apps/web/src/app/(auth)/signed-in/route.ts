import { NextResponse } from 'next/server';
import { setTenantOverride } from '@/lib/session';

// Where Clerk lands after a sign-in or an organization switch (local mode does this in startSession): forgets the
// tenant a previous SuperAdmin session had open, which would otherwise ride along as X-Tenant-Id and get 403s.
export async function GET(request: Request): Promise<Response> {
  await setTenantOverride(null);
  return NextResponse.redirect(new URL('/', request.url));
}
