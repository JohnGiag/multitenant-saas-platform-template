import type { PaidTier } from '@repo/shared-types';
import type { PlatformSetting } from '../../../modules/system/domain/optional-module.js';

export interface BillingConfig {
  secretKey: string;
  webhookSecret: string;
  // The Stripe price each paid tier sells (Dashboard → Product catalog).
  prices: Record<PaidTier, string>;
}

const ENV = {
  secretKey: 'STRIPE_SECRET_KEY',
  webhookSecret: 'STRIPE_WEBHOOK_SECRET',
  pro: 'STRIPE_PRICE_PRO',
  enterprise: 'STRIPE_PRICE_ENTERPRISE',
} as const;

// None set: billing is installed but off. Some set: they must all be valid, or the boot fails (a half-configured
// billing would take money and never grant the tier). Names only in errors: the values include the secret key.
export function billingConfig(setting: PlatformSetting): BillingConfig | null {
  const values = Object.fromEntries(Object.entries(ENV).map(([field, name]) => [field, setting(name)])) as Record<
    keyof typeof ENV,
    string | undefined
  >;
  if (Object.values(values).every((v) => v === undefined)) return null;
  const checks: [keyof typeof ENV, RegExp][] = [
    ['secretKey', /^(sk|rk)_/],
    ['webhookSecret', /^whsec_/],
    ['pro', /^price_/],
    ['enterprise', /^price_/],
  ];
  const bad = checks.filter(([field, pattern]) => !pattern.test(values[field] ?? '')).map(([field]) => ENV[field]);
  if (bad.length > 0) throw new Error(`Billing needs valid ${bad.join(', ')} (or none of STRIPE_* set)`);
  if (values.pro === values.enterprise) throw new Error('STRIPE_PRICE_PRO and STRIPE_PRICE_ENTERPRISE must differ');
  return {
    secretKey: values.secretKey!,
    webhookSecret: values.webhookSecret!,
    prices: { pro: values.pro!, enterprise: values.enterprise! },
  };
}
