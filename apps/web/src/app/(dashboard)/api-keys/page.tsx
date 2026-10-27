import type { ApiKeySummary, CursorPage } from '@repo/shared-types';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Pager } from '@/components/pager';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, getPrincipal } from '@/lib/api';
import { revokeApiKey } from './actions';
import { CreateApiKeyForm } from './create-api-key-form';

export const metadata: Metadata = { title: 'API keys' };

const PAGE_SIZE = 50;

// Keys for the tenant's own software (servers, scripts) to call this API; not the BYOK keys in Settings.
export default async function ApiKeysPage({ searchParams }: PageProps<'/api-keys'>) {
  const me = await getPrincipal();
  // A tenant's own admins only: SuperAdmin manages tenants, not what is inside them.
  if (me.role !== 'TenantAdmin' && me.role !== 'Auditor') notFound();
  const canManage = me.role === 'TenantAdmin';
  const { cursor } = await searchParams;
  const current = typeof cursor === 'string' ? cursor : undefined;
  const keys = await api<CursorPage<ApiKeySummary>>(
    `/api-keys?${new URLSearchParams({ limit: String(PAGE_SIZE), ...(current && { cursor: current }) })}`,
  );

  return (
    <div className="grid max-w-5xl gap-6">
      <h1 className="text-2xl font-semibold">API keys</h1>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Create a key</h2>
            </CardTitle>
            <CardDescription>
              For your own servers and scripts to call this API as this tenant. Name it after where it is used, and give it the least role it needs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateApiKeyForm />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Keys</h2>
          </CardTitle>
          <CardDescription>Newest first. A revoked key stops working immediately.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {keys.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No API keys yet.</p>
          ) : (
            <Table>
              <TableCaption className="sr-only">API keys of this tenant</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Name</TableHead>
                  <TableHead scope="col">Prefix</TableHead>
                  <TableHead scope="col">Role</TableHead>
                  <TableHead scope="col">Created</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  {canManage && <TableHead scope="col">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.items.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell className="font-mono">{k.prefix}</TableCell>
                    <TableCell>{k.role}</TableCell>
                    <TableCell>
                      <time dateTime={k.createdAt}>{k.createdAt.slice(0, 10)}</time>
                    </TableCell>
                    <TableCell>
                      {k.revokedAt ? (
                        <Badge variant="outline">
                          Revoked <time dateTime={k.revokedAt}>{k.revokedAt.slice(0, 10)}</time>
                        </Badge>
                      ) : (
                        <Badge>Active</Badge>
                      )}
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        {!k.revokedAt && (
                          <ActionForm
                            action={revokeApiKey.bind(null, k.id)}
                            submitLabel="Revoke"
                            variant="destructive"
                            size="sm"
                            confirm={`Revoke “${k.name}”? Clients using it stop working immediately.`}
                            className="flex items-center gap-2"
                          />
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pager next={keys.nextCursor && `/api-keys?${new URLSearchParams({ cursor: keys.nextCursor })}`} first={current && '/api-keys'} label="API keys" />
        </CardContent>
      </Card>
    </div>
  );
}
