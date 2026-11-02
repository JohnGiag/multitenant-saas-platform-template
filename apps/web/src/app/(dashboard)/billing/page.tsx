import { ConfirmCheckoutSchema, type BillingStatus } from '@repo/shared-types';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, ApiError, getCapabilities, getPrincipal } from '@/lib/api';
import { getT, pageTitle } from '@/lib/i18n';
import { getTestMode } from '@/lib/session';
import { openPortal, startCheckout } from './actions';

export const generateMetadata = pageTitle('nav.billing');

// Stripe statuses after which a new checkout starts a new subscription (the API's ENDED_STATUSES).
const ENDED = new Set(['canceled', 'incomplete_expired']);

export default async function BillingPage({ searchParams }: PageProps<'/billing'>) {
  const [me, t] = await Promise.all([getPrincipal(), getT()]);
  // The tenant's own subscription: its admins manage it, Auditors read it, SuperAdmin stays out.
  if ((me.role !== 'TenantAdmin' && me.role !== 'Auditor') || (await getTestMode())) notFound();
  if (!(await getCapabilities()).some((c) => c.key === 'billing' && c.enabled)) notFound();
  const canManage = me.role === 'TenantAdmin';
  // Back from Stripe Checkout with the session id Stripe put in the link: applied now rather than when the webhook
  // arrives. If that fails (Stripe unreachable), the webhook still applies it shortly.
  const returned = ConfirmCheckoutSchema.safeParse({ sessionId: (await searchParams).checkout_session });
  const confirmed = canManage && returned.success ? await confirmCheckout(returned.data.sessionId) : null;
  const billing = confirmed ?? (await api<BillingStatus>('/billing'));
  const subscribed = billing.status !== null && !ENDED.has(billing.status);

  return (
    <div className="grid max-w-3xl gap-6">
      <h1 className="text-2xl font-semibold">{t('nav.billing')}</h1>
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {returned.success ? t(confirmed && confirmed.tier !== 'free' ? 'billing.checkoutActive' : 'billing.checkoutDone') : ''}
      </p>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t('billing.planTitle')}</h2>
          </CardTitle>
          <CardDescription>{t('billing.planText')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            <dt className="text-muted-foreground">{t('common.tier')}</dt>
            <dd className="font-medium capitalize">{billing.tier}</dd>
            {billing.status && (
              <>
                <dt className="text-muted-foreground">{t('common.status')}</dt>
                <dd>
                  <Badge variant="outline">{billing.status}</Badge>
                </dd>
              </>
            )}
            {subscribed && billing.cancelAt && (
              <>
                <dt className="text-muted-foreground">{t('billing.endsOn')}</dt>
                <dd>
                  <time dateTime={billing.cancelAt}>{billing.cancelAt.slice(0, 10)}</time>
                </dd>
              </>
            )}
            {subscribed && !billing.cancelAt && billing.currentPeriodEnd && (
              <>
                <dt className="text-muted-foreground">{t('billing.renewsOn')}</dt>
                <dd>
                  <time dateTime={billing.currentPeriodEnd}>{billing.currentPeriodEnd.slice(0, 10)}</time>
                </dd>
              </>
            )}
          </dl>
          {!subscribed && <p className="text-muted-foreground">{t('billing.none')}</p>}
          {subscribed && billing.cancelAt && <p className="text-muted-foreground">{t('billing.endsOnText')}</p>}
          {billing.status === 'past_due' && <p className="text-destructive">{t('billing.pastDue')}</p>}
        </CardContent>
      </Card>

      {!canManage ? (
        <p className="text-sm text-muted-foreground">{t('billing.adminsOnly')}</p>
      ) : subscribed ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('billing.manageTitle')}</h2>
            </CardTitle>
            <CardDescription>{t('billing.manageText')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={openPortal} submitLabel={t('billing.manage')} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('billing.chooseTitle')}</h2>
            </CardTitle>
            <CardDescription>{t('billing.chooseText')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <ActionForm action={startCheckout.bind(null, 'pro')} submitLabel={t('billing.upgradePro')} />
            <ActionForm action={startCheckout.bind(null, 'enterprise')} submitLabel={t('billing.upgradeEnterprise')} variant="outline" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

async function confirmCheckout(sessionId: string): Promise<BillingStatus | null> {
  try {
    return await api<BillingStatus>('/billing/checkout/confirm', { method: 'POST', body: { sessionId } });
  } catch (error) {
    if (error instanceof ApiError) return null;
    throw error;
  }
}
