import type { UsageList } from '@repo/shared-types';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, getPrincipal } from '@/lib/api';
import { getT, pageTitle } from '@/lib/i18n';
import { usageState, type UsageState } from '@/lib/usage';

export const generateMetadata = pageTitle('nav.usage');

const STATE_LABELS: Record<UsageState, string> = {
  unlimited: 'usage.withinLimit',
  within: 'usage.withinLimit',
  near: 'usage.nearLimit',
  over: 'usage.overLimit',
  refused: 'usage.refused',
};

// The tenant's own use: its admins and Auditors read it, SuperAdmin stays out.
export default async function UsagePage() {
  const [me, t] = await Promise.all([getPrincipal(), getT()]);
  if (me.role !== 'TenantAdmin' && me.role !== 'Auditor') notFound();
  const { meters } = await api<UsageList>('/usage');

  return (
    <div className="grid max-w-3xl gap-6">
      <h1 className="text-2xl font-semibold">{t('nav.usage')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t('nav.usage')}</h2>
          </CardTitle>
          <CardDescription>{t('usage.text')}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {meters.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('usage.none')}</p>
          ) : (
            <Table>
              <TableCaption className="sr-only">{t('usage.caption')}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t('usage.meter')}</TableHead>
                  <TableHead scope="col">{t('usage.used')}</TableHead>
                  <TableHead scope="col">{t('usage.limit')}</TableHead>
                  <TableHead scope="col">{t('common.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {meters.map((meter) => {
                  const state = usageState(meter);
                  return (
                    <TableRow key={meter.meter}>
                      <TableCell className="font-mono text-sm">{meter.meter}</TableCell>
                      <TableCell>{meter.used}</TableCell>
                      <TableCell>{meter.limit ?? t('usage.unlimited')}</TableCell>
                      <TableCell>
                        <Badge variant={state === 'refused' || state === 'over' ? 'destructive' : state === 'near' ? 'default' : 'secondary'}>{t(STATE_LABELS[state])}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
