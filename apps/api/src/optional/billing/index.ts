import type { OptionalModule } from '../../modules/system/domain/optional-module.js';
import { BillingModule } from './billing.module.js';
import { billingConfig } from './infrastructure/billing-config.js';

// Subscriptions through Stripe, which set each tenant's tier. The platform charges its tenants with its own Stripe
// account (STRIPE_*), so there is no tenant integration. Delete this folder to uninstall (billing_accounts then
// stays unused, and SuperAdmins set tiers by hand again).
export default {
  key: 'billing',
  platformReady: (setting) => billingConfig(setting) !== null,
  ownsTenantTier: true,
  module: BillingModule,
} satisfies OptionalModule;
