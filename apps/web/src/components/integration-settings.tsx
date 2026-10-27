import type { TenantIntegration } from '@repo/shared-types';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/field';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { removeIntegration, saveIntegration } from '@/app/(dashboard)/actions';
import { capabilityTitle, type ConfigurableCapability } from '@/lib/capabilities';
import { INTEGRATION_FIELDS } from '@/lib/integration-fields';

interface IntegrationSettingsProps {
  capability: ConfigurableCapability;
  integration: TenantIntegration | undefined;
  canManage: boolean;
}

// Secrets are write-only: the API only ever returns masked values, so changing the config means entering it again.
export function IntegrationSettings({ capability, integration, canManage }: IntegrationSettingsProps) {
  const provider = capability.integration;
  const fields = INTEGRATION_FIELDS[provider];
  const id = (name: string) => `${provider}-${name}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          <h2>{capabilityTitle(capability.key)}</h2>
          <Badge variant={capability.enabled ? 'default' : 'outline'}>{capability.enabled ? 'Enabled' : 'Not configured'}</Badge>
        </CardTitle>
        <CardDescription>
          Integration <code>{provider}</code>
          {capability.enabled && !integration && ': using the platform defaults until you set your own.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {integration && (
          <section aria-labelledby={id('current')}>
            <h3 id={id('current')} className="mb-2 text-sm font-medium">
              Current config {integration.enabled ? '' : '(disabled)'}
            </h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
              {Object.entries(integration.maskedConfig).map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-muted-foreground">{key}</dt>
                  <dd className="font-mono break-all">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {canManage && (
          <section aria-labelledby={id('edit')}>
            <h3 id={id('edit')} className="mb-2 text-sm font-medium">
              {integration ? 'Replace config' : 'Set up'}
            </h3>
            <ActionForm action={saveIntegration.bind(null, provider)} submitLabel="Save">
              {fields ? (
                fields.map((f) => (
                  <Field
                    key={f.name}
                    id={id(f.name)}
                    name={f.name}
                    label={f.optional ? `${f.label} (optional)` : f.label}
                    hint={f.hint}
                    required={!f.optional}
                    autoComplete="off"
                    spellCheck={false}
                    {...(f.multiline ? { multiline: true, rows: 6 } : { type: f.secret ? 'password' : 'text' })}
                  />
                ))
              ) : (
                <Field id={id('config')} name="config" label="Config (JSON)" multiline rows={6} required spellCheck={false} hint='A JSON object of strings, e.g. {"apiKey": "…"}.' />
              )}
              <div className="flex items-center gap-2">
                <Checkbox id={id('enabled')} name="enabled" defaultChecked={integration?.enabled ?? true} />
                <Label htmlFor={id('enabled')}>Enabled</Label>
              </div>
            </ActionForm>
          </section>
        )}
        {canManage && integration && (
          <section aria-labelledby={id('remove')}>
            <h3 id={id('remove')} className="mb-2 text-sm font-medium">
              Remove
            </h3>
            <ActionForm action={removeIntegration.bind(null, provider)} submitLabel={`Remove ${provider} config`}
              variant="destructive"
              confirm={`Remove the ${provider} config? Its secrets are deleted and cannot be shown again.`}
            />
          </section>
        )}
      </CardContent>
    </Card>
  );
}
