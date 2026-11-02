import type { CursorPage, WebhookEndpoint, WebhookEventTypes } from '@repo/shared-types';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Pager } from '@/components/pager';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, getCapabilities, getPrincipal } from '@/lib/api';
import { getT, pageTitle } from '@/lib/i18n';
import { deleteEndpoint, sendTest, setEnabled } from './actions';
import { CreateEndpointForm, RotateSecretForm } from './secret-forms';

export const generateMetadata = pageTitle('nav.webhooks');

const PAGE_SIZE = 50;

export default async function WebhooksPage({ searchParams }: PageProps<'/webhooks'>) {
  const [me, t] = await Promise.all([getPrincipal(), getT()]);
  // The tenant's own endpoints: its admins manage them, Auditors read them, SuperAdmin stays out.
  if (me.role !== 'TenantAdmin' && me.role !== 'Auditor') notFound();
  if (!(await getCapabilities()).some((c) => c.key === 'webhooks' && c.enabled)) notFound();
  const canManage = me.role === 'TenantAdmin';
  const { cursor } = await searchParams;
  const current = typeof cursor === 'string' ? cursor : undefined;
  const [endpoints, { types }] = await Promise.all([
    api<CursorPage<WebhookEndpoint>>(`/webhooks?${new URLSearchParams({ limit: String(PAGE_SIZE), ...(current && { cursor: current }) })}`),
    api<WebhookEventTypes>('/webhooks/event-types'),
  ]);

  return (
    <div className="grid max-w-5xl gap-6">
      <h1 className="text-2xl font-semibold">{t('nav.webhooks')}</h1>
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('webhooks.createTitle')}</h2>
            </CardTitle>
            <CardDescription>{t('webhooks.createText')}</CardDescription>
          </CardHeader>
          <CardContent>
            <CreateEndpointForm eventTypes={types} />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t('webhooks.listTitle')}</h2>
          </CardTitle>
          <CardDescription>{t('webhooks.listText')}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {endpoints.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('webhooks.none')}</p>
          ) : (
            <Table>
              <TableCaption className="sr-only">{t('webhooks.caption')}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t('webhooks.url')}</TableHead>
                  <TableHead scope="col">{t('webhooks.events')}</TableHead>
                  <TableHead scope="col">{t('common.status')}</TableHead>
                  {canManage && <TableHead scope="col">{t('common.actions')}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {endpoints.items.map((endpoint) => (
                  <TableRow key={endpoint.id} className="align-top">
                    <TableCell className="max-w-xs whitespace-normal">
                      <span className="font-mono text-sm break-all">{endpoint.url}</span>
                      {endpoint.description && <span className="block text-sm text-muted-foreground">{endpoint.description}</span>}
                      <Link
                        href={`/webhooks/${endpoint.id}?${new URLSearchParams({ url: endpoint.url })}`}
                        aria-label={t('webhooks.deliveriesOf', { url: endpoint.url })}
                        className="block text-sm underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
                      >
                        {t('webhooks.deliveries')}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {endpoint.events.length === 0 ? (
                        t('webhooks.allEvents')
                      ) : (
                        <ul className="font-mono text-sm">
                          {endpoint.events.map((type) => (
                            <li key={type}>{type}</li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={endpoint.enabled ? 'secondary' : 'outline'}>{t(endpoint.enabled ? 'webhooks.on' : 'webhooks.off')}</Badge>
                    </TableCell>
                    {canManage && (
                      <TableCell className="whitespace-normal">
                        <div className="flex flex-wrap items-start gap-2">
                          {endpoint.enabled && (
                            <ActionForm action={sendTest.bind(null, endpoint.id)} submitLabel={t('webhooks.sendTest')} variant="outline" size="sm" />
                          )}
                          <ActionForm
                            action={setEnabled.bind(null, endpoint.id, !endpoint.enabled)}
                            submitLabel={t(endpoint.enabled ? 'webhooks.turnOff' : 'webhooks.turnOn')}
                            variant="outline"
                            size="sm"
                          />
                          <RotateSecretForm id={endpoint.id} url={endpoint.url} />
                          <ActionForm
                            action={deleteEndpoint.bind(null, endpoint.id)}
                            submitLabel={t('common.delete')}
                            variant="destructive"
                            size="sm"
                            confirm={t('webhooks.deleteConfirm', { url: endpoint.url })}
                          />
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pager next={endpoints.nextCursor && `/webhooks?${new URLSearchParams({ cursor: endpoints.nextCursor })}`} first={current && '/webhooks'} label={t('nav.webhooks')} />
        </CardContent>
      </Card>
    </div>
  );
}
