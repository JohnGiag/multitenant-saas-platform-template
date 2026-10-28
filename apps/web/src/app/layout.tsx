import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { CLERK } from '@/lib/auth-mode';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · Admin' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        {/* Clerk mode only: local mode has no Clerk keys, and the provider would refuse to start without them. */}
        {CLERK ? (
          // Pending sessions (no organization chosen yet) come back to /login, which shows the choice.
          <ClerkProvider signInUrl="/login" afterSignOutUrl="/login" taskUrls={{ 'choose-organization': '/login' }}>
            {children}
          </ClerkProvider>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
