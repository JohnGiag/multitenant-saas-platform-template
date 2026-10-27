import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="grid min-h-dvh place-items-center p-4">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
