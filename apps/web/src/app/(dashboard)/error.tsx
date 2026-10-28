'use client';

import { useT } from '@/components/i18n-provider';
import { Button } from '@/components/ui/button';

// Rendered inside the dashboard layout, so the tenant switcher stays usable (e.g. if the selected tenant was deleted).
export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="grid max-w-xl gap-4">
      <h1 className="text-2xl font-semibold">{t('error.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('error.text')}</p>
      <Button onClick={reset} className="justify-self-start">
        {t('common.tryAgain')}
      </Button>
    </div>
  );
}
