import type { CursorPage, Tenant } from '@repo/shared-types';
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
import { api, getCapabilities, getPrincipal } from '@/lib/api';
import { CLERK } from '@/lib/auth-mode';
import { getT, pageTitle } from '@/lib/i18n';
import { getTenantOverride } from '@/lib/session';
import { createTenant, deleteTenant, openTenant, updateTenant } from './actions';

export const generateMetadata = pageTitle('nav.tenants');

const PAGE_SIZE = 50;

export default async function TenantsPage({ searchParams }: PageProps<'/tenants'>) {
  const [me, t] = await Promise.all([getPrincipal(), getT()]);
  if (me.role !== 'SuperAdmin') notFound();
  const { cursor } = await searchParams;
  const current = typeof cursor === 'string' ? cursor : undefined;
  const [tenants, selected, capabilities] = await Promise.all([
    api<CursorPage<Tenant>>(`/tenants?${new URLSearchParams({ limit: String(PAGE_SIZE), ...(current && { cursor: current }) })}`, { ownTenant: true }),
    getTenantOverride(),
    getCapabilities(),
  ]);
  // Billing on: tiers follow subscriptions (the API refuses a change). With Clerk too, nothing is left to edit here.
  const billing = capabilities.some((c) => c.key === 'billing' && c.enabled);
  const editable = !(CLERK && billing);
  const activeId = selected ?? me.tenantId;

  return (
    <div className="grid max-w-5xl gap-6">
      <h1 className="text-2xl font-semibold">{t('nav.tenants')}</h1>

      {/* Clerk mode: tenants are Clerk organizations, created and deleted there (the API answers 409 here). */}
      {CLERK ? (
        <p className="text-sm text-muted-foreground">{t('tenants.clerk')}</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('tenants.createTitle')}</h2>
            </CardTitle>
            <CardDescription>{t('tenants.createText')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={createTenant} submitLabel={t('tenants.createButton')} className="sm:grid-cols-[1fr_auto] sm:items-end">
              <Field id="new-tenant-name" name="name" label={t('common.name')} required maxLength={100} autoComplete="off" />
            </ActionForm>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t('tenants.all')}</h2>
          </CardTitle>
          <CardDescription>{t('tenants.allText')}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableCaption className="sr-only">{t('tenants.caption')}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t('common.name')}</TableHead>
                <TableHead scope="col">{t('common.tier')}</TableHead>
                <TableHead scope="col">{t('common.created')}</TableHead>
                <TableHead scope="col">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.items.map((tenant) => {
                const isPlatform = tenant.id === me.tenantId;
                return (
                  <TableRow key={tenant.id} className="align-top">
                    <TableCell className="font-medium">
                      <span className="flex flex-wrap items-center gap-2">
                        {tenant.name}
                        {isPlatform && <Badge variant="secondary">{t('tenants.platform')}</Badge>}
                        {tenant.id === activeId && <Badge variant="outline">{t('tenants.selected')}</Badge>}
                      </span>
                    </TableCell>
                    <TableCell className="capitalize">{tenant.tier}</TableCell>
                    <TableCell>
                      <time dateTime={tenant.createdAt}>{tenant.createdAt.slice(0, 10)}</time>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="flex flex-wrap items-start gap-2">
                        {tenant.id !== activeId && (
                          <form action={openTenant.bind(null, tenant.id)}>
                            <Button type="submit" size="sm" variant="outline" aria-label={t('tenants.openLabel', { name: tenant.name })}>
                              {t('tenants.open')}
                            </Button>
                          </form>
                        )}
                        <details className="group min-w-0">
                          <summary className="inline-flex h-8 cursor-pointer items-center rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
                            {t('tenants.manage')}<span className="sr-only"> {tenant.name}</span>
                          </summary>
                          <div className="mt-3 grid w-72 gap-4 rounded-md border p-4">
                            {editable && (
                              <ActionForm action={updateTenant.bind(null, tenant.id)} submitLabel={t('common.save')} size="sm">
                                {/* Clerk mode: the organization's name, renamed in Clerk (the API answers 409). */}
                                {!CLERK && <Field id={`name-${tenant.id}`} name="name" label={t('common.name')} required maxLength={100} defaultValue={tenant.name} />}
                                {!billing && (
                                  <div className="grid gap-2">
                                    <Label htmlFor={`tier-${tenant.id}`}>{t('common.tier')}</Label>
                                    <TierSelect id={`tier-${tenant.id}`} defaultValue={tenant.tier} />
                                  </div>
                                )}
                              </ActionForm>
                            )}
                            {billing && <p className="text-sm text-muted-foreground">{t('tenants.tierByBilling')}</p>}
                            {!isPlatform && !CLERK && (
                              <ActionForm action={deleteTenant.bind(null, tenant.id, tenant.name)} submitLabel={t('tenants.deleteButton')} variant="destructive" size="sm">
                                <Field
                                  id={`confirm-${tenant.id}`}
                                  name="confirm"
                                  label={t('tenants.typeToDelete', { name: tenant.name })}
                                  hint={t('tenants.deleteHint')}
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
          <Pager next={tenants.nextCursor && `/tenants?${new URLSearchParams({ cursor: tenants.nextCursor })}`} first={current && '/tenants'} label={t('nav.tenants')} />
        </CardContent>
      </Card>
    </div>
  );
}
