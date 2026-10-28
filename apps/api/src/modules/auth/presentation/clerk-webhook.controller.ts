import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiHeader } from '@nestjs/swagger';
import { ApiDoc } from '../../../common/api-doc.js';
import { z } from 'zod';
import { verifyWebhookSignature } from '../domain/webhook-signature.js';
import { ClerkWebhookHandler } from '../infrastructure/clerk-webhook.handler.js';
import { Public } from './decorators.js';

// timestamp: when Clerk created the event, in ms; unlike svix-timestamp, it stays the same on every retry.
const EventSchema = z.object({ type: z.string(), data: z.unknown(), timestamp: z.number().int().positive() });

interface WebhookRequest {
  // Kept by createApp ({ rawBody: true }): the signature covers the exact bytes Clerk sent.
  rawBody?: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

@Controller('auth/clerk')
export class ClerkWebhookController {
  constructor(
    private readonly config: ConfigService,
    private readonly handler: ClerkWebhookHandler,
  ) {}

  // Public: Clerk calls it through Svix, and the signature is the credential. Exists only in Clerk mode.
  @Public()
  @ApiDoc('Clerk webhook (Clerk mode only): mirrors organizations, memberships and users. Signed by Svix')
  @ApiHeader({ name: 'svix-id', required: true })
  @ApiHeader({ name: 'svix-timestamp', required: true, description: 'Unix seconds; refused when more than 5 minutes off' })
  @ApiHeader({ name: 'svix-signature', required: true, description: 'HMAC-SHA256 of the raw body, keyed with CLERK_WEBHOOK_SECRET' })
  @Post('webhook')
  @HttpCode(204)
  async receive(@Req() req: WebhookRequest, @Body() body: unknown): Promise<void> {
    const secret = this.config.get<string>('CLERK_WEBHOOK_SECRET');
    if (this.config.get<string>('AUTH_PROVIDER') !== 'clerk' || !secret) throw new NotFoundException();
    const header = (name: string) => {
      const value = req.headers[name];
      return typeof value === 'string' ? value : '';
    };
    const signed =
      req.rawBody !== undefined &&
      verifyWebhookSignature({
        secret,
        id: header('svix-id'),
        timestamp: header('svix-timestamp'),
        signatures: header('svix-signature'),
        body: req.rawBody,
      });
    if (!signed) throw new UnauthorizedException('Invalid webhook signature');

    const event = EventSchema.safeParse(body);
    if (!event.success) throw new BadRequestException('Not a Clerk event');
    try {
      await this.handler.handle(event.data.type, event.data.data, new Date(event.data.timestamp));
    } catch (error) {
      // A malformed payload will not improve on retry; anything else (e.g. the database) should be retried.
      if (error instanceof z.ZodError) throw new BadRequestException(`Unexpected ${event.data.type} payload`);
      throw error;
    }
  }
}
