import type { CursorPage, Tenant } from '@repo/shared-types';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { TierSelect } from '@/components/choice-select';
import { Field } from '@/components/field';
import { Pager } from '@/components/pager';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, getPrincipal } from '@/lib/api';
import { CLERK } from '@/lib/auth-mode';
import { getTenantOverride } from '@/lib/session';
import { createTenant, deleteTenant, openTenant, updateTenant } from './actions';

export const metadata: Metadata = { title: 'Tenants' };

const PAGE_SIZE = 50;

export default async function TenantsPage({ searchParams }: PageProps<'/tenants'>) {
  const me = await getPrincipal();
  if (me.role !== 'SuperAdmin') notFound();
  const { cursor } = await searchParams;
  const current = typeof cursor === 'string' ? cursor : undefined;
  const [tenants, selected] = await Promise.all([
    api<CursorPage<Tenant>>(`/tenants?${new URLSearchParams({ limit: String(PAGE_SIZE), ...(current && { cursor: current }) })}`, { ownTenant: true }),
    getTenantOverride(),
  ]);
  const activeId = selected ?? me.tenantId;

  return (
    <div className="grid max-w-5xl gap-6">
      <h1 className="text-2xl font-semibold">Tenants</h1>

      {/* Clerk mode: tenants are Clerk organizations, created and deleted there (the API answers 409 here). */}
      {CLERK ? (
        <p className="text-sm text-muted-foreground">Tenants are your Clerk organizations: create and delete them in Clerk.</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Create a tenant</h2>
            </CardTitle>
            <CardDescription>New tenants start on the free tier. Open it afterwards and invite its first TenantAdmin from Users.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={createTenant} submitLabel="Create tenant" className="sm:grid-cols-[1fr_auto] sm:items-end">
              <Field id="new-tenant-name" name="name" label="Name" required maxLength={100} autoComplete="off" />
            </ActionForm>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>All tenants</h2>
          </CardTitle>
          <CardDescription>The tier sets each tenant&apos;s rate limit: free 120, pro 600, enterprise 3000 requests per minute.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableCaption className="sr-only">All tenants on the platform</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Name</TableHead>
                <TableHead scope="col">Tier</TableHead>
                <TableHead scope="col">Created</TableHead>
                <TableHead scope="col">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.items.map((t) => {
                const isPlatform = t.id === me.tenantId;
                return (
                  <TableRow key={t.id} className="align-top">
                    <TableCell className="font-medium">
                      <span className="flex flex-wrap items-center gap-2">
                        {t.name}
                        {isPlatform && <Badge variant="secondary">Platform</Badge>}
                        {t.id === activeId && <Badge variant="outline">Selected</Badge>}
                      </span>
                    </TableCell>
                    <TableCell className="capitalize">{t.tier}</TableCell>
                    <TableCell>
                      <time dateTime={t.createdAt}>{t.createdAt.slice(0, 10)}</time>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="flex flex-wrap items-start gap-2">
                        {t.id !== activeId && (
                          <form action={openTenant.bind(null, t.id)}>
                            <Button type="submit" size="sm" variant="outline" aria-label={`Open ${t.name}`}>
                              Open
                            </Button>
                          </form>
                        )}
                        <details className="group min-w-0">
                          <summary className="inline-flex h-8 cursor-pointer items-center rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
                            Manage<span className="sr-only"> {t.name}</span>
                          </summary>
                          <div className="mt-3 grid w-72 gap-4 rounded-md border p-4">
                            <ActionForm action={updateTenant.bind(null, t.id)} submitLabel="Save" size="sm">
                              {/* Clerk mode: the organization's name, renamed in Clerk (the API answers 409). */}
                              {!CLERK && <Field id={`name-${t.id}`} name="name" label="Name" required maxLength={100} defaultValue={t.name} />}
                              <div className="grid gap-2">
                                <Label htmlFor={`tier-${t.id}`}>Tier</Label>
                                <TierSelect id={`tier-${t.id}`} defaultValue={t.tier} />
                              </div>
                            </ActionForm>
                            {!isPlatform && !CLERK && (
                              <ActionForm action={deleteTenant.bind(null, t.id, t.name)} submitLabel="Delete tenant" variant="destructive" size="sm">
                                <Field
                                  id={`confirm-${t.id}`}
                                  name="confirm"
                                  label={`Type “${t.name}” to delete it`}
                                  hint="Deletes its users, invitations, API keys, integrations, jobs and files. This cannot be undone."
                                  required
                                  autoComplete="off"
                                />
                              </ActionForm>
                            )}
                          </div>
                        </details>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <Pager next={tenants.nextCursor && `/tenants?${new URLSearchParams({ cursor: tenants.nextCursor })}`} first={current && '/tenants'} label="tenants" />
        </CardContent>
      </Card>
    </div>
  );
}
