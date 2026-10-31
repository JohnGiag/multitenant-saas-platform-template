import type { FeatureFlag, Tenant } from '@repo/shared-types';
import { ActionForm } from '@/components/action-form';
import { OverrideSelect } from '@/components/choice-select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { saveFeatureFlag } from '@/app/(dashboard)/actions';
import { getT } from '@/lib/i18n';
import type { Translate } from '@/lib/translate';

function source({ override, minTier }: FeatureFlag, t: Translate): string {
  if (override !== null) return t('features.fromOverride');
  if (minTier === null) return t('features.fromNone');
  return minTier === 'free' ? t('features.fromAllPlans') : t('features.fromPlan', { tier: minTier });
}

interface FeatureFlagSettingsProps {
  flags: FeatureFlag[];
  tenant: Tenant;
  // SuperAdmin only: overrides stand in for the tier, so a tenant cannot set its own.
  canOverride: boolean;
}

export async function FeatureFlagSettings({ flags, tenant, canOverride }: FeatureFlagSettingsProps) {
  const t = await getT();
  const optionLabels = { default: t('features.useDefault'), on: t('features.forceOn'), off: t('features.forceOff') };
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('settings.features')}</h2>
        </CardTitle>
        <CardDescription>{t('features.text', { name: tenant.name })}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-6">
          {flags.map((flag) => {
            const name = t(`flag.${flag.key}`);
            return (
              <li key={flag.key} className="grid gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium">{name}</span>
                  <Badge variant={flag.enabled ? 'default' : 'outline'}>{flag.enabled ? t('features.on') : t('features.off')}</Badge>
                  <span className="text-sm text-muted-foreground">{source(flag, t)}</span>
                </div>
                {canOverride && (
                  <ActionForm action={saveFeatureFlag.bind(null, flag.key)} submitLabel={t('common.save')} size="sm">
                    <OverrideSelect
                      label={t('features.overrideLabel', { name })}
                      defaultValue={flag.override === null ? 'default' : flag.override ? 'on' : 'off'}
                      optionLabels={optionLabels}
                    />
                  </ActionForm>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
