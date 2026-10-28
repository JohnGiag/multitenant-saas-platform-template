import type { CursorPage, TenantIntegration } from '@repo/shared-types';
import type { Metadata } from 'next';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/field';
import { IntegrationSettings } from '@/components/integration-settings';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, getCapabilities, getCurrentTenant, getPrincipal } from '@/lib/api';
import { CLERK } from '@/lib/auth-mode';
import { capabilityTitle, configurableCapabilities } from '@/lib/capabilities';
import { renameTenant } from '../actions';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const [me, tenant, capabilities] = await Promise.all([getPrincipal(), getCurrentTenant(), getCapabilities()]);
  // One tab per installed module the caller may configure; uninstalled modules are simply absent.
  const configurable = configurableCapabilities(capabilities, me.role);
  const integrations = configurable.length
    ? (await api<CursorPage<TenantIntegration>>('/integrations?limit=100')).items
    : [];
  // Clerk mode: the name is the Clerk organization's, renamed there (the API answers 409 here).
  const canRename = !CLERK && (me.role === 'TenantAdmin' || me.role === 'SuperAdmin');

  return (
    <div className="grid max-w-3xl gap-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Tabs defaultValue="general">
        <TabsList aria-label="Settings sections" className="h-auto flex-wrap">
          <TabsTrigger value="general">General</TabsTrigger>
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
                <h2>Tenant</h2>
              </CardTitle>
              <CardDescription>The organization this workspace belongs to.</CardDescription>
            </CardHeader>
            <CardContent>
              {canRename ? (
                <ActionForm action={renameTenant} submitLabel="Save">
                  <Field id="tenant-name" name="name" label="Name" required maxLength={100} defaultValue={tenant.name} />
                </ActionForm>
              ) : (
                <p className="text-sm">{tenant.name}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
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
