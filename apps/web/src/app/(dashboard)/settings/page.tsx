import type { CursorPage, TenantIntegration } from '@repo/shared-types';
import { ActionForm } from '@/components/action-form';
import { FeatureFlagSettings } from '@/components/feature-flag-settings';
import { Field } from '@/components/field';
import { IntegrationSettings } from '@/components/integration-settings';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, getCapabilities, getCurrentTenant, getFeatureFlags, getPrincipal } from '@/lib/api';
import { CLERK } from '@/lib/auth-mode';
import { capabilityTitle, configurableCapabilities } from '@/lib/capabilities';
import { getT, pageTitle } from '@/lib/i18n';
import { renameTenant } from '../actions';

export const generateMetadata = pageTitle('nav.settings');

export default async function SettingsPage() {
  const [me, tenant, capabilities, flags, t] = await Promise.all([getPrincipal(), getCurrentTenant(), getCapabilities(), getFeatureFlags(), getT()]);
  // One tab per installed module the caller may configure; uninstalled modules are simply absent.
  const configurable = configurableCapabilities(capabilities, me.role);
  const integrations = configurable.length
    ? (await api<CursorPage<TenantIntegration>>('/integrations?limit=100')).items
    : [];
  // Clerk mode: the name is the Clerk organization's, renamed there (the API answers 409 here).
  const canRename = !CLERK && (me.role === 'TenantAdmin' || me.role === 'SuperAdmin');

  return (
    <div className="grid max-w-3xl gap-6">
      <h1 className="text-2xl font-semibold">{t('nav.settings')}</h1>
      <Tabs defaultValue="general">
        <TabsList aria-label={t('settings.sections')} className="h-auto flex-wrap">
          <TabsTrigger value="general">{t('settings.general')}</TabsTrigger>
          {flags.length > 0 && <TabsTrigger value="features">{t('settings.features')}</TabsTrigger>}
          {configurable.map((c) => (
            <TabsTrigger key={c.key} value={c.key}>
              {capabilityTitle(c.key)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="general">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>{t('common.tenant')}</h2>
              </CardTitle>
              <CardDescription>{t('settings.tenantText')}</CardDescription>
            </CardHeader>
            <CardContent>
              {canRename ? (
                <ActionForm action={renameTenant} submitLabel={t('common.save')}>
                  <Field id="tenant-name" name="name" label={t('common.name')} required maxLength={100} defaultValue={tenant.name} />
                </ActionForm>
              ) : (
                <p className="text-sm">{tenant.name}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        {flags.length > 0 && (
          <TabsContent value="features">
            <FeatureFlagSettings flags={flags} tenant={tenant} canOverride={me.role === 'SuperAdmin'} />
          </TabsContent>
        )}
        {configurable.map((c) => (
          <TabsContent key={c.key} value={c.key}>
            <IntegrationSettings
              capability={c}
              integration={integrations.find((i) => i.provider === c.integration)}
              canManage={me.role === 'TenantAdmin'}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
