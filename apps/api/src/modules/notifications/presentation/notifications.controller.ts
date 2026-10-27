import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import {
  SendNotificationSchema,
  type Principal,
  type SendNotificationDto,
  type SendNotificationResult,
} from '@repo/shared-types';
import { Observable } from 'rxjs';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { CurrentPrincipal, Roles } from '../../auth/presentation/decorators.js';
import { TenantId } from '../../tenancy/presentation/tenant-context.js';
import { NOTIFICATION_SERVICE, type NotificationService } from '../domain/ports/notification.service.js';

@Controller('notifications')
export class NotificationsController {
  constructor(@Inject(NOTIFICATION_SERVICE) private readonly notifications: NotificationService) {}

  // A tenant's own admins only: SuperAdmin manages tenants and their users, not their messaging.
  @Roles('TenantAdmin')
  @Post()
  @HttpCode(202)
  async send(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(SendNotificationSchema)) body: SendNotificationDto,
  ): Promise<SendNotificationResult> {
    const result = await this.notifications.send(tenantId, body);
    if (!result) throw new NotFoundException('Recipient is not a user of this tenant');
    return result;
  }

  // The caller's own notifications, so the principal (not @TenantId) decides whose stream this is.
  // Browsers' EventSource cannot send Authorization headers: use a fetch-based SSE client.
  @Roles('SuperAdmin', 'TenantAdmin', 'User', 'Auditor')
  @Sse('stream')
  stream(@CurrentPrincipal() principal: Principal): Observable<MessageEvent> {
    if (principal.kind !== 'user') throw new ForbiddenException('Only users receive notifications');
    const events = this.notifications.stream(principal.tenantId, principal.id);
    // Forwards completion too, so a stream closed by the server ends the HTTP response.
    return new Observable<MessageEvent>((subscriber) => events.subscribe(subscriber));
  }
}
