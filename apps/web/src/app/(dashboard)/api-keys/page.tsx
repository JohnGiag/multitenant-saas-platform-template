import type { ApiKeySummary, CursorPage } from '@repo/shared-types';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Pager } from '@/components/pager';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, getPrincipal } from '@/lib/api';
import { getT, pageTitle } from '@/lib/i18n';
import { revokeApiKey } from './actions';
import { CreateApiKeyForm } from './create-api-key-form';

export const generateMetadata = pageTitle('nav.apiKeys');

const PAGE_SIZE = 50;

// Keys for the tenant's own software (servers, scripts) to call this API; not the BYOK keys in Settings.
export default async function ApiKeysPage({ searchParams }: PageProps<'/api-keys'>) {
  const [me, t] = await Promise.all([getPrincipal(), getT()]);
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
      <h1 className="text-2xl font-semibold">{t('nav.apiKeys')}</h1>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('apiKeys.createTitle')}</h2>
            </CardTitle>
            <CardDescription>{t('apiKeys.createText')}</CardDescription>
          </CardHeader>
          <CardContent>
            <CreateApiKeyForm />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t('apiKeys.keys')}</h2>
          </CardTitle>
          <CardDescription>{t('apiKeys.keysText')}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {keys.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('apiKeys.none')}</p>
          ) : (
            <Table>
              <TableCaption className="sr-only">{t('apiKeys.caption')}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t('common.name')}</TableHead>
                  <TableHead scope="col">{t('apiKeys.prefix')}</TableHead>
                  <TableHead scope="col">{t('common.role')}</TableHead>
                  <TableHead scope="col">{t('common.created')}</TableHead>
                  <TableHead scope="col">{t('common.status')}</TableHead>
                  {canManage && <TableHead scope="col">{t('common.actions')}</TableHead>}
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
                          {t('apiKeys.revoked')} <time dateTime={k.revokedAt}>{k.revokedAt.slice(0, 10)}</time>
                        </Badge>
                      ) : (
                        <Badge>{t('apiKeys.active')}</Badge>
                      )}
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        {!k.revokedAt && (
                          <ActionForm
                            action={revokeApiKey.bind(null, k.id)}
                            submitLabel={t('common.revoke')}
                            variant="destructive"
                            size="sm"
                            confirm={t('apiKeys.revokeConfirm', { name: k.name })}
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
          <Pager next={keys.nextCursor && `/api-keys?${new URLSearchParams({ cursor: keys.nextCursor })}`} first={current && '/api-keys'} label={t('nav.apiKeys')} />
        </CardContent>
      </Card>
    </div>
  );
}
