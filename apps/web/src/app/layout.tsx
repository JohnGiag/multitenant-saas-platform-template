import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { I18nProvider } from '@/components/i18n-provider';
import { CLERK } from '@/lib/auth-mode';
import { getLocale, getMessages } from '@/lib/i18n';
import { THEME_SCRIPT } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · Admin' },
};

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta' });

// Clerk's widgets take our theme tokens, so they follow light and dark with the rest of the page.
const clerkAppearance = {
  variables: {
    colorPrimary: 'var(--primary)',
    colorPrimaryForeground: 'var(--primary-foreground)',
    colorDanger: 'var(--destructive)',
    colorBackground: 'var(--card)',
    colorForeground: 'var(--foreground)',
    colorMuted: 'var(--muted)',
    colorMutedForeground: 'var(--muted-foreground)',
    colorInput: 'var(--card)',
    colorInputForeground: 'var(--foreground)',
    colorBorder: 'var(--input)',
    colorRing: 'var(--ring)',
    fontFamily: 'var(--font-jakarta)',
  },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  return (
    // The theme script sets the `dark` class before React hydrates.
    <html lang={locale} className={jakarta.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh font-sans antialiased">
        <I18nProvider locale={locale} messages={messages}>
          {/* Clerk mode only: local mode has no Clerk keys, and the provider would refuse to start without them. */}
          {CLERK ? (
            // Pending sessions (no organization chosen yet) come back to /login, which shows the choice.
            <ClerkProvider signInUrl="/login" afterSignOutUrl="/login" taskUrls={{ 'choose-organization': '/login' }} appearance={clerkAppearance}>
              {children}
            </ClerkProvider>
          ) : (
            children
          )}
        </I18nProvider>
      </body>
    </html>
  );
}
