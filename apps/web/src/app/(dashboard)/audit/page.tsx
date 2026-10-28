import type { AuditLogEntry, CursorPage } from '@repo/shared-types';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Field } from '@/components/field';
import { Pager } from '@/components/pager';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, getPrincipal } from '@/lib/api';
import { AUDIT_FILTER_KEYS, AuditFilterFormSchema } from '@/lib/audit-filter';
import { getT, pageTitle } from '@/lib/i18n';

export const generateMetadata = pageTitle('nav.audit');

const PAGE_SIZE = 50;

const utc = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;

export default async function AuditPage({ searchParams }: PageProps<'/audit'>) {
  const [me, t] = await Promise.all([getPrincipal(), getT()]);
  if (me.role === 'User') notFound();
  const isSuperAdmin = me.role === 'SuperAdmin';
  const params = await searchParams;
  const current = typeof params.cursor === 'string' ? params.cursor : undefined;
  // As typed, for the form and the page links; empty fields count as unset.
  const raw = Object.fromEntries(
    AUDIT_FILTER_KEYS.flatMap((k) => {
      const v = params[k];
      return typeof v === 'string' && v.trim() ? [[k, v.trim()]] : [];
    }),
  ) as Partial<Record<(typeof AUDIT_FILTER_KEYS)[number], string>>;
  const filter = AuditFilterFormSchema.safeParse(raw);
  const href = (cursor?: string) => `/audit?${new URLSearchParams({ ...raw, ...(cursor && { cursor }) })}`;
  // A SuperAdmin always reads the platform tenant's trail (its own actions), whichever tenant it has open.
  const entries = filter.success
    ? await api<CursorPage<AuditLogEntry>>(
        `/audit-logs?${new URLSearchParams({ ...filter.data, limit: String(PAGE_SIZE), ...(current && { cursor: current }) })}`,
        { ownTenant: isSuperAdmin },
      )
    : null;
  const filtered = Object.keys(raw).length > 0;

  return (
    <div className="grid max-w-6xl gap-6">
      <h1 className="text-2xl font-semibold">{t('nav.audit')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t('audit.filter')}</h2>
          </CardTitle>
          <CardDescription>{t('audit.filterText')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" action="/audit" className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="actorId" name="actorId" label={t('audit.actorId')} defaultValue={raw.actorId} hint={t('audit.actorIdHint')} />
              <Field id="targetId" name="targetId" label={t('audit.targetId')} defaultValue={raw.targetId} hint={t('audit.targetIdHint')} />
              <Field id="from" name="from" type="date" label={t('audit.from')} defaultValue={raw.from} />
              <Field id="to" name="to" type="date" label={t('audit.to')} defaultValue={raw.to} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit">{t('audit.filterButton')}</Button>
              {filtered && (
                <Button asChild variant="outline">
                  <Link href="/audit">{t('audit.clear')}</Link>
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{isSuperAdmin ? t('audit.platformActions') : t('audit.recordedActions')}</h2>
          </CardTitle>
          <CardDescription>
            {t('audit.text')}
            {isSuperAdmin && ` ${t('audit.superAdminText')}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!entries ? (
            <Alert variant="destructive">
              <AlertDescription>{t('audit.badFilter')}</AlertDescription>
            </Alert>
          ) : entries.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{filtered ? t('audit.noMatch') : t('audit.empty')}</p>
          ) : (
            <Table>
              <TableCaption className="sr-only">{t('audit.caption')}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t('audit.when')}</TableHead>
                  <TableHead scope="col">{t('audit.actor')}</TableHead>
                  <TableHead scope="col">{t('audit.action')}</TableHead>
                  <TableHead scope="col">{t('audit.target')}</TableHead>
                  {isSuperAdmin && <TableHead scope="col">{t('audit.onTenant')}</TableHead>}
                  <TableHead scope="col">{t('common.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.items.map((e) => (
                  <TableRow key={e.id} className="align-top">
                    <TableCell>
                      <time dateTime={e.createdAt}>{utc(e.createdAt)}</time>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {e.actorId === me.id ? t('common.you') : t(e.actorKind === 'apiKey' ? 'audit.apiKeyActor' : 'audit.userActor', { role: e.actorRole })}
                      <Link
                        href={`/audit?${new URLSearchParams({ actorId: e.actorId })}`}
                        aria-label={t('audit.byActor', { id: e.actorId })}
                        className="block font-mono text-xs break-all text-muted-foreground underline underline-offset-4"
                      >
                        {e.actorId}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {e.method} {e.route}
                    </TableCell>
                    <TableCell className="font-mono text-xs break-all whitespace-normal">
                      {e.targetId ? (
                        <Link
                          href={`/audit?${new URLSearchParams({ targetId: e.targetId })}`}
                          aria-label={t('audit.onTarget', { id: e.targetId })}
                          className="underline underline-offset-4"
                        >
                          {e.targetId}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    {isSuperAdmin && <TableCell className="font-mono text-xs break-all whitespace-normal">{e.actedOnTenantId ?? '—'}</TableCell>}
                    <TableCell>{e.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pager next={entries?.nextCursor && href(entries.nextCursor)} first={current && href()} label={t('audit.entries')} />
        </CardContent>
      </Card>
    </div>
  );
}
