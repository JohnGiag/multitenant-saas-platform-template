import { Body, Controller, Delete, ForbiddenException, HttpCode, Param, Post } from '@nestjs/common';
import { RegisterPushDeviceSchema, type Principal, type RegisterPushDeviceDto } from '@repo/shared-types';
import { ApiDoc } from '../../common/api-doc.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { CurrentPrincipal, Roles } from '../../modules/auth/presentation/decorators.js';

// Enough for a person's phones and browsers; each one adds a request to every notification they get.
export const MAX_DEVICES_PER_USER = 20;

// Devices belong to the caller's own account, so the principal (not @TenantId) decides the owner.
@Controller('push/devices')
@Roles('SuperAdmin', 'TenantAdmin', 'User')
export class PushDevicesController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiDoc("Register this device's FCM token for your push notifications. Within a tenant a token moves to whoever registers it last; past 20 devices, your oldest is dropped")
  @Post()
  @HttpCode(204)
  async register(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(RegisterPushDeviceSchema)) { token }: RegisterPushDeviceDto,
  ): Promise<void> {
    const owner = userOf(principal);
    // A device that signs in to another account of this tenant now belongs to that account.
    await this.prisma.pushDevice.upsert({
      where: { tenantId_token: { tenantId: owner.tenantId, token } },
      create: { token, ...owner },
      update: owner,
    });
    const devices = await this.prisma.pushDevice.findMany({ where: owner, orderBy: { updatedAt: 'desc' }, select: { id: true } });
    const oldest = devices.slice(MAX_DEVICES_PER_USER).map((d) => d.id);
    if (oldest.length > 0) await this.prisma.pushDevice.deleteMany({ where: { tenantId: owner.tenantId, id: { in: oldest } } });
  }

  @ApiDoc('Unregister one of your devices')
  @Delete(':token')
  @HttpCode(204)
  async unregister(@CurrentPrincipal() principal: Principal, @Param('token') token: string): Promise<void> {
    await this.prisma.pushDevice.deleteMany({ where: { token, ...userOf(principal) } });
  }
}

function userOf(principal: Principal) {
  if (principal.kind !== 'user') throw new ForbiddenException('Only users have devices');
  return { tenantId: principal.tenantId, userId: principal.id };
}
