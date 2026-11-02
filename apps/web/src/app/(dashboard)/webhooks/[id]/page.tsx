import { IdSchema, type CursorPage, type WebhookDelivery, type WebhookDeliveryError } from '@repo/shared-types';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Pager } from '@/components/pager';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, ApiError, getCapabilities, getPrincipal } from '@/lib/api';
import { getT, pageTitle } from '@/lib/i18n';
import { redeliver } from '../actions';

export const generateMetadata = pageTitle('webhooks.deliveries');

const PAGE_SIZE = 50;
const ERROR_LABELS: Record<WebhookDeliveryError, string> = {
  timeout: 'webhooks.errorTimeout',
  refused_address: 'webhooks.errorRefusedAddress',
  network: 'webhooks.errorNetwork',
};

const delivered = ({ statusCode }: WebhookDelivery) => statusCode !== null && statusCode >= 200 && statusCode < 300;
const moment = (iso: string) => <time dateTime={iso}>{iso.slice(0, 19).replace('T', ' ')}</time>;

// The endpoint's own admins see this and can redeliver; Auditors read it; SuperAdmin stays out.
export default async function WebhookDeliveriesPage({ params, searchParams }: PageProps<'/webhooks/[id]'>) {
  const [me, t] = await Promise.all([getPrincipal(), getT()]);
  if (me.role !== 'TenantAdmin' && me.role !== 'Auditor') notFound();
  if (!(await getCapabilities()).some((c) => c.key === 'webhooks' && c.enabled)) notFound();
  const id = IdSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const canManage = me.role === 'TenantAdmin';
  const { cursor, url } = await searchParams;
  const current = typeof cursor === 'string' ? cursor : undefined;
  const deliveries = await api<CursorPage<WebhookDelivery>>(
    `/webhooks/${id.data}/deliveries?${new URLSearchParams({ limit: String(PAGE_SIZE), ...(current && { cursor: current }) })}`,
  ).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });
  const here = `/webhooks/${id.data}`;

  return (
    <div className="grid max-w-5xl gap-6">
      <h1 className="text-2xl font-semibold">{t('webhooks.deliveries')}</h1>
      <Link href="/webhooks" className="text-sm underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
        {t('webhooks.back')}
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="font-mono text-base break-all">{typeof url === 'string' ? url : t('webhooks.deliveries')}</h2>
          </CardTitle>
          <CardDescription>{t('webhooks.deliveriesText')}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {deliveries.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('webhooks.deliveriesNone')}</p>
          ) : (
            <Table>
              <TableCaption className="sr-only">{t('webhooks.deliveriesCaption')}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t('webhooks.event')}</TableHead>
                  <TableHead scope="col">{t('webhooks.attempt')}</TableHead>
                  <TableHead scope="col">{t('webhooks.result')}</TableHead>
                  <TableHead scope="col">{t('webhooks.duration')}</TableHead>
                  <TableHead scope="col">{t('common.created')}</TableHead>
                  <TableHead scope="col">{t('webhooks.nextRetry')}</TableHead>
                  {canManage && <TableHead scope="col">{t('common.actions')}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.items.map((delivery) => (
                  <TableRow key={delivery.id}>
                    <TableCell className="font-mono text-sm">{delivery.eventType}</TableCell>
                    <TableCell>{delivery.attempt}</TableCell>
                    <TableCell>
                      <Badge variant={delivered(delivery) ? 'secondary' : 'outline'}>{delivery.error ? t(ERROR_LABELS[delivery.error]) : delivery.statusCode}</Badge>
                    </TableCell>
                    <TableCell>{delivery.durationMs} ms</TableCell>
                    <TableCell>{moment(delivery.createdAt)}</TableCell>
                    <TableCell>{delivery.nextRetryAt && moment(delivery.nextRetryAt)}</TableCell>
                    {canManage && (
                      <TableCell>
                        <ActionForm action={redeliver.bind(null, id.data, delivery.id)} submitLabel={t('webhooks.redeliver')} variant="outline" size="sm" />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pager next={deliveries.nextCursor && `${here}?${new URLSearchParams({ cursor: deliveries.nextCursor })}`} first={current && here} label={t('webhooks.deliveries')} />
        </CardContent>
      </Card>
    </div>
  );
}
