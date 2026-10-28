import type { AuditLogEntry, CursorPage } from '@repo/shared-types';
import type { Metadata } from 'next';
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

export const metadata: Metadata = { title: 'Audit log' };

const PAGE_SIZE = 50;

const utc = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;

export default async function AuditPage({ searchParams }: PageProps<'/audit'>) {
  const me = await getPrincipal();
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
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Filter</h2>
          </CardTitle>
          <CardDescription>Leave a field empty to match everything. Select an actor or target ID in the table to filter by it.</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" action="/audit" className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="actorId" name="actorId" label="Actor ID" defaultValue={raw.actorId} hint="The user or API key that acted." />
              <Field id="targetId" name="targetId" label="Target ID" defaultValue={raw.targetId} hint="The record acted on." />
              <Field id="from" name="from" type="date" label="From (UTC)" defaultValue={raw.from} />
              <Field id="to" name="to" type="date" label="To (UTC, inclusive)" defaultValue={raw.to} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit">Filter</Button>
              {filtered && (
                <Button asChild variant="outline">
                  <Link href="/audit">Clear filters</Link>
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{isSuperAdmin ? 'Platform actions' : 'Recorded actions'}</h2>
          </CardTitle>
          <CardDescription>
            Every successful change made by a signed-in user or API key, newest first. Reads, rejected requests and sign-ins are not recorded.
            {isSuperAdmin && ' SuperAdmin actions on other tenants are kept here, even after that tenant is deleted.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!entries ? (
            <Alert variant="destructive">
              <AlertDescription>
                Check the filters: the actor ID must be a full ID, and the dates must be valid.
              </AlertDescription>
            </Alert>
          ) : entries.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{filtered ? 'Nothing matches these filters.' : 'Nothing recorded yet.'}</p>
          ) : (
            <Table>
              <TableCaption className="sr-only">Audit log entries, newest first</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">When</TableHead>
                  <TableHead scope="col">Actor</TableHead>
                  <TableHead scope="col">Action</TableHead>
                  <TableHead scope="col">Target</TableHead>
                  {isSuperAdmin && <TableHead scope="col">On tenant</TableHead>}
                  <TableHead scope="col">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.items.map((e) => (
                  <TableRow key={e.id} className="align-top">
                    <TableCell>
                      <time dateTime={e.createdAt}>{utc(e.createdAt)}</time>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {e.actorId === me.id ? 'You' : `${e.actorRole} ${e.actorKind === 'apiKey' ? 'API key' : 'user'}`}
                      <Link
                        href={`/audit?${new URLSearchParams({ actorId: e.actorId })}`}
                        aria-label={`Show only actions by ${e.actorId}`}
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
                          aria-label={`Show only actions on ${e.targetId}`}
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
          <Pager next={entries?.nextCursor && href(entries.nextCursor)} first={current && href()} label="audit log entries" />
        </CardContent>
      </Card>
    </div>
  );
}
