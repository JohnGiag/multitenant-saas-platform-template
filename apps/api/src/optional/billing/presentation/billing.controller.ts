import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  BillingRedirectSchema,
  BillingStatusSchema,
  ConfirmCheckoutSchema,
  CreateCheckoutSchema,
  type BillingRedirect,
  type BillingStatus,
  type ConfirmCheckoutDto,
  type CreateCheckoutDto,
} from '@repo/shared-types';
import { ApiDoc } from '../../../common/api-doc.js';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { Roles } from '../../../modules/auth/presentation/decorators.js';
import { TenantId } from '../../../modules/tenancy/presentation/tenant-context.js';
import {
  BILLING_SERVICE,
  BillingConflictError,
  BillingNotConfiguredError,
  BillingNotFoundError,
  type BillingService,
} from '../domain/ports/billing.service.js';

// The tenant's own subscription: its admins manage it, Auditors read it, SuperAdmin stays out (it sets no tiers
// while billing is on). Card details never reach the API: Stripe hosts the checkout and the portal.
@Controller('billing')
@Roles('TenantAdmin')
export class BillingController {
  constructor(@Inject(BILLING_SERVICE) private readonly billing: BillingService) {}

  @Roles('TenantAdmin', 'Auditor')
  @ApiDoc("The tenant's tier and subscription: status, renewal, and a scheduled cancellation", BillingStatusSchema)
  @Get()
  status(@TenantId() tenantId: string): Promise<BillingStatus> {
    return this.billing.status(tenantId);
  }

  @ApiDoc('Start a subscription: a Stripe Checkout page to send the browser to (409 if one is already running)', BillingRedirectSchema)
  @Post('checkout')
  async checkout(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(CreateCheckoutSchema)) { tier }: CreateCheckoutDto,
  ): Promise<BillingRedirect> {
    return { url: await withBilling(this.billing.checkout(tenantId, tier)) };
  }

  @ApiDoc(
    'Back from Checkout: apply the paid subscription now, without waiting for its webhook. Safe to repeat; an unpaid session changes nothing',
    BillingStatusSchema,
  )
  @Post('checkout/confirm')
  @HttpCode(200)
  confirm(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(ConfirmCheckoutSchema)) { sessionId }: ConfirmCheckoutDto,
  ): Promise<BillingStatus> {
    return withBilling(this.billing.confirmCheckout(tenantId, sessionId));
  }

  @ApiDoc('Manage the subscription (plan, payment method, cancellation, invoices) in the Stripe Customer Portal', BillingRedirectSchema)
  @Post('portal')
  async portal(@TenantId() tenantId: string): Promise<BillingRedirect> {
    return { url: await withBilling(this.billing.portal(tenantId)) };
  }
}

async function withBilling<T>(pending: Promise<T>): Promise<T> {
  try {
    return await pending;
  } catch (error) {
    if (error instanceof BillingNotConfiguredError) throw new ServiceUnavailableException(error.message);
    if (error instanceof BillingConflictError) throw new ConflictException(error.message);
    if (error instanceof BillingNotFoundError) throw new NotFoundException(error.message);
    throw error;
  }
}
