import type { ReactNode } from 'react';
import { Brand } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-dvh bg-[radial-gradient(ellipse_at_top,var(--color-sidebar-accent),transparent_60%)]">
      <main id="main" className="grid min-h-dvh place-items-center p-4">
        {/* Submit buttons span the card on these single-purpose forms. */}
        <div className="grid w-full max-w-sm gap-6 [&_form>button[type=submit]]:justify-self-stretch">
          <Brand className="justify-center text-lg" />
          {children}
        </div>
      </main>
      {/* After the form in tab order, so the first Tab still reaches it. */}
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
    </div>
  );
}
