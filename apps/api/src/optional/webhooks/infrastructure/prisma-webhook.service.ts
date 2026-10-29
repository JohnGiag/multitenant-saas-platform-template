import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CreatedWebhookEndpoint,
  CreateWebhookEndpointDto,
  CursorPage,
  UpdateWebhookEndpointDto,
  WebhookEndpoint,
  WebhookEndpointPageQuery,
  WebhookPayload,
  WebhookSecret,
} from '@repo/shared-types';
import type { Queue } from 'bullmq';
import { toCursorPage } from '../../../common/cursor-page.js';
import type { WebhookEndpoint as EndpointRow } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { TenantEvents, type TenantEvent } from '../../../modules/events/domain/tenant-events.js';
import { parseMasterKey, sealSecret } from '../../../modules/integrations/domain/secret-box.js';
import { DELIVERY_ATTEMPTS, endpointUrlProblem } from '../domain/delivery-policy.js';
import {
  MAX_ENDPOINTS_PER_TENANT,
  WebhookInputError,
  WebhookLimitError,
  type WebhookService,
} from '../domain/ports/webhook.service.js';
import { newWebhookSecret } from '../domain/standard-webhooks.js';
import { allowPrivateTargets } from './webhooks-config.js';

export const WEBHOOKS_QUEUE = 'webhooks';

// One delivery: an event to one endpoint. The endpoint (and its secret) is loaded when the job runs, so a rotated
// secret or a changed URL applies to deliveries still waiting.
export interface WebhookDeliveryJob {
  tenantId: string;
  endpointId: string;
  payload: WebhookPayload;
}

// Bound to the tenant, so a ciphertext copied into another tenant's row does not decrypt.
export const secretContext = (tenantId: string) => `${tenantId}/webhooks`;

const toEndpoint = (row: EndpointRow): WebhookEndpoint => ({
  id: row.id,
  url: row.url,
  description: row.description,
  events: row.events,
  enabled: row.enabled,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

@Injectable()
export class PrismaWebhookService implements WebhookService, OnModuleInit {
  private readonly masterKey: Uint8Array;
  private readonly allowPrivate: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: TenantEvents,
    @InjectQueue(WEBHOOKS_QUEUE) private readonly queue: Queue<WebhookDeliveryJob>,
    config: ConfigService,
  ) {
    this.masterKey = parseMasterKey(config.getOrThrow<string>('BYOK_MASTER_KEY'));
    this.allowPrivate = allowPrivateTargets(config);
  }

  onModuleInit(): void {
    this.events.subscribe((event) => this.fanOut(event));
  }

  eventTypes(): string[] {
    return this.events.declaredTypes();
  }

  async list(tenantId: string, { cursor, limit }: WebhookEndpointPageQuery): Promise<CursorPage<WebhookEndpoint>> {
    const rows = await this.prisma.webhookEndpoint.findMany({
      where: { tenantId, ...(cursor && { id: { gt: cursor } }) },
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    return toCursorPage(rows.map(toEndpoint), limit, (e) => e.id);
  }

  async create(tenantId: string, { url, description, events }: CreateWebhookEndpointDto): Promise<CreatedWebhookEndpoint> {
    this.check({ url, events });
    const secret = newWebhookSecret();
    const row = await this.prisma.$transaction(async (tx) => {
      // Serializes a tenant's creations, so two at once cannot both take the last place. NO KEY: plain FOR UPDATE
      // would also block every insert that references the tenant.
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR NO KEY UPDATE`;
      if ((await tx.webhookEndpoint.count({ where: { tenantId } })) >= MAX_ENDPOINTS_PER_TENANT) {
        throw new WebhookLimitError(`A tenant can have at most ${MAX_ENDPOINTS_PER_TENANT} webhook endpoints`);
      }
      return tx.webhookEndpoint.create({
        data: { tenantId, url, description: description || null, events, encryptedSecret: this.seal(tenantId, secret) },
      });
    });
    return { ...toEndpoint(row), secret };
  }

  async update(tenantId: string, id: string, input: UpdateWebhookEndpointDto): Promise<WebhookEndpoint | null> {
    this.check(input);
    const { count } = await this.prisma.webhookEndpoint.updateMany({
      where: { id, tenantId },
      data: { ...input, ...(input.description !== undefined && { description: input.description || null }) },
    });
    if (count === 0) return null;
    return toEndpoint(await this.prisma.webhookEndpoint.findFirstOrThrow({ where: { id, tenantId } }));
  }

  async remove(tenantId: string, id: string): Promise<boolean> {
    // Deliveries still queued for it find it gone and are skipped.
    const { count } = await this.prisma.webhookEndpoint.deleteMany({ where: { id, tenantId } });
    return count === 1;
  }

  async rotateSecret(tenantId: string, id: string): Promise<WebhookSecret | null> {
    const secret = newWebhookSecret();
    const { count } = await this.prisma.webhookEndpoint.updateMany({
      where: { id, tenantId },
      data: { encryptedSecret: this.seal(tenantId, secret) },
    });
    return count === 1 ? { secret } : null;
  }

  async sendTest(tenantId: string, id: string): Promise<'queued' | 'disabled' | null> {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({ where: { id, tenantId }, select: { id: true, enabled: true } });
    if (!endpoint) return null;
    if (!endpoint.enabled) return 'disabled';
    const event: TenantEvent = { id: `evt_${randomUUID()}`, type: 'webhook.test', tenantId, occurredAt: new Date(), data: {} };
    await this.enqueue(event, [endpoint.id]);
    return 'queued';
  }

  // Every enabled endpoint of the tenant that wants this event type gets its own delivery job.
  private async fanOut(event: TenantEvent): Promise<void> {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { tenantId: event.tenantId, enabled: true, OR: [{ events: { isEmpty: true } }, { events: { has: event.type } }] },
      select: { id: true },
    });
    await this.enqueue(event, endpoints.map((e) => e.id));
  }

  private async enqueue(event: TenantEvent, endpointIds: string[]): Promise<void> {
    if (endpointIds.length === 0) return;
    const payload: WebhookPayload = {
      id: event.id,
      type: event.type,
      tenantId: event.tenantId,
      timestamp: event.occurredAt.toISOString(),
      data: event.data,
    };
    await this.queue.addBulk(
      endpointIds.map((endpointId) => ({
        name: event.type,
        data: { tenantId: event.tenantId, endpointId, payload },
        // The webhook's own schedule (WebhooksWorker), not the shared one: about a day of retries. A fixed id per
        // event and endpoint, so an event queued twice is delivered once.
        opts: { jobId: `${event.id}-${endpointId}`, attempts: DELIVERY_ATTEMPTS, backoff: { type: 'webhook' } },
      })),
    );
  }

  private check({ url, events }: { url?: string; events?: string[] }): void {
    const problem = url === undefined ? null : endpointUrlProblem(url, this.allowPrivate);
    if (problem) throw new WebhookInputError(problem);
    const known = new Set(this.eventTypes());
    const unknown = (events ?? []).filter((type) => !known.has(type));
    if (unknown.length > 0) throw new WebhookInputError(`Unknown event types: ${unknown.join(', ')}`);
  }

  private seal(tenantId: string, secret: string): Uint8Array<ArrayBuffer> {
    return sealSecret(this.masterKey, secret, secretContext(tenantId));
  }
}
