import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CreatedWebhookEndpointSchema,
  CreateWebhookEndpointSchema,
  cursorPage,
  pageQuery,
  UpdateWebhookEndpointSchema,
  WebhookDeliverySchema,
  WebhookEndpointPageQuerySchema,
  WebhookEndpointSchema,
  WebhookEventTypesSchema,
  WebhookSecretSchema,
  type CreatedWebhookEndpoint,
  type CreateWebhookEndpointDto,
  type CursorPage,
  type UpdateWebhookEndpointDto,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookEndpointPageQuery,
  type WebhookEventTypes,
  type WebhookSecret,
} from '@repo/shared-types';
import { z } from 'zod';
import { ApiDoc } from '../../../common/api-doc.js';
import { keysetCursorSchema } from '../../../common/keyset.js';
import { unavailableOnTimeout } from '../../../common/unavailable-on-timeout.js';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { RequireScope, Roles } from '../../../modules/auth/presentation/decorators.js';
import { RequireFeature } from '../../../modules/feature-flags/presentation/require-feature.js';
import { Idempotent } from '../../../modules/idempotency/presentation/idempotency.guard.js';
import { TenantId } from '../../../modules/tenancy/presentation/tenant-context.js';
import {
  WEBHOOK_SERVICE,
  WEBHOOKS_FEATURE,
  WebhookInputError,
  WebhookLimitError,
  type WebhookService,
} from '../domain/ports/webhook.service.js';

// Deliveries are listed by created_at, so the cursor value must be a timestamp.
const DeliveryPageQuerySchema = pageQuery(keysetCursorSchema(z.iso.datetime()));

// Where the tenant's events go. Its own admins manage endpoints and Auditors read them; SuperAdmin stays out (the
// events are the tenant's business data, and the secrets sign in its name).
@Controller('webhooks')
@RequireScope()
@Roles('TenantAdmin')
@RequireFeature(WEBHOOKS_FEATURE)
export class WebhooksController {
  constructor(@Inject(WEBHOOK_SERVICE) private readonly webhooks: WebhookService) {}

  @Roles('TenantAdmin', 'Auditor')
  @ApiDoc("List the tenant's webhook endpoints, oldest first (no secrets)", cursorPage(WebhookEndpointSchema))
  @Get()
  list(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(WebhookEndpointPageQuerySchema)) query: WebhookEndpointPageQuery,
  ): Promise<CursorPage<WebhookEndpoint>> {
    return this.webhooks.list(tenantId, query);
  }

  @Roles('TenantAdmin', 'Auditor')
  @ApiDoc('Every event type an endpoint can subscribe to', WebhookEventTypesSchema)
  @Get('event-types')
  eventTypes(): WebhookEventTypes {
    return { types: this.webhooks.eventTypes() };
  }

  @ApiDoc(
    'Add an endpoint (https only). `secret` is returned this once: verify each delivery with it (Standard Webhooks). At most 10 per tenant',
    CreatedWebhookEndpointSchema,
  )
  @Idempotent({ secret: true })
  @Post()
  create(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(CreateWebhookEndpointSchema)) body: CreateWebhookEndpointDto,
  ): Promise<CreatedWebhookEndpoint> {
    return withInput(this.webhooks.create(tenantId, body));
  }

  @ApiDoc("Change an endpoint's URL, description, event types, or turn it off and on", WebhookEndpointSchema)
  @Patch(':id')
  async update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateWebhookEndpointSchema)) body: UpdateWebhookEndpointDto,
  ): Promise<WebhookEndpoint> {
    return found(await withInput(this.webhooks.update(tenantId, id, body)));
  }

  @ApiDoc('Remove an endpoint; deliveries still waiting for it are dropped')
  @Delete(':id')
  @HttpCode(204)
  async remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    if (!(await this.webhooks.remove(tenantId, id))) throw new NotFoundException();
  }

  @ApiDoc('Replace the signing secret: the new one is returned this once, and the old one stops signing at once', WebhookSecretSchema)
  @Post(':id/rotate-secret')
  @HttpCode(200)
  async rotateSecret(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<WebhookSecret> {
    return found(await this.webhooks.rotateSecret(tenantId, id));
  }

  @ApiDoc('Send this endpoint a "webhook.test" event, to check it receives and verifies deliveries', null)
  @Post(':id/test')
  @HttpCode(202)
  async test(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    const result = await this.webhooks.sendTest(tenantId, id).catch(unavailableOnTimeout);
    if (result === 'disabled') throw new ConflictException('This endpoint is turned off: turn it on first');
    found(result);
  }

  @Roles('TenantAdmin', 'Auditor')
  @ApiDoc('Every attempt to deliver an event to this endpoint, newest first, for the last 30 days', cursorPage(WebhookDeliverySchema))
  @Get(':id/deliveries')
  async deliveries(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(DeliveryPageQuerySchema)) query: z.infer<typeof DeliveryPageQuerySchema>,
  ): Promise<CursorPage<WebhookDelivery>> {
    return found(await this.webhooks.deliveries(tenantId, id, query));
  }
}

@Controller('webhook-deliveries')
@RequireScope()
@Roles('TenantAdmin')
@RequireFeature(WEBHOOKS_FEATURE)
export class WebhookDeliveriesController {
  constructor(@Inject(WEBHOOK_SERVICE) private readonly webhooks: WebhookService) {}

  @ApiDoc('Send a delivery again, with its original `webhook-id` so receivers can still drop duplicates', null)
  @Post(':id/redeliver')
  @HttpCode(202)
  async redeliver(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    const result = await this.webhooks.redeliver(tenantId, id).catch(unavailableOnTimeout);
    if (result === 'disabled') throw new ConflictException('This endpoint is turned off: turn it on first');
    found(result);
  }
}

function found<T>(value: T | null): T {
  if (value === null) throw new NotFoundException();
  return value;
}

async function withInput<T>(pending: Promise<T>): Promise<T> {
  try {
    return await pending;
  } catch (error) {
    if (error instanceof WebhookInputError) throw new BadRequestException(error.message);
    if (error instanceof WebhookLimitError) throw new ConflictException(error.message);
    throw error;
  }
}
