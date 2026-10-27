'use client';

import { Button } from '@/components/ui/button';

// Rendered inside the dashboard layout, so the tenant switcher stays usable (e.g. if the selected tenant was deleted).
export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="grid max-w-xl gap-4">
      <h1 className="text-2xl font-semibold">This page could not be loaded</h1>
      <p className="text-sm text-muted-foreground">The API refused or did not answer the request. Try again, or pick another tenant.</p>
      <Button onClick={reset} className="justify-self-start">
        Try again
      </Button>
    </div>
  );
}
