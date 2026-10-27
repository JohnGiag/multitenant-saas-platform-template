import type { AuditLogEntry, CursorPage } from '@repo/shared-types';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Pager } from '@/components/pager';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, getPrincipal } from '@/lib/api';

export const metadata: Metadata = { title: 'Audit log' };

const PAGE_SIZE = 50;

const utc = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;

export default async function AuditPage({ searchParams }: PageProps<'/audit'>) {
  const me = await getPrincipal();
  if (me.role === 'User') notFound();
  const isSuperAdmin = me.role === 'SuperAdmin';
  const { cursor } = await searchParams;
  const current = typeof cursor === 'string' ? cursor : undefined;
  // A SuperAdmin always reads the platform tenant's trail (its own actions), whichever tenant it has open.
  const entries = await api<CursorPage<AuditLogEntry>>(
    `/audit-logs?${new URLSearchParams({ limit: String(PAGE_SIZE), ...(current && { cursor: current }) })}`,
    { ownTenant: isSuperAdmin },
  );

  return (
    <div className="grid max-w-6xl gap-6">
      <h1 className="text-2xl font-semibold">Audit log</h1>
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
          {entries.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
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
                      <span className="block font-mono text-xs break-all text-muted-foreground">{e.actorId}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {e.method} {e.route}
                    </TableCell>
                    <TableCell className="font-mono text-xs break-all whitespace-normal">{e.targetId ?? '—'}</TableCell>
                    {isSuperAdmin && <TableCell className="font-mono text-xs break-all whitespace-normal">{e.actedOnTenantId ?? '—'}</TableCell>}
                    <TableCell>{e.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pager next={entries.nextCursor && `/audit?${new URLSearchParams({ cursor: entries.nextCursor })}`} first={current && '/audit'} label="audit log entries" />
        </CardContent>
      </Card>
    </div>
  );
}
