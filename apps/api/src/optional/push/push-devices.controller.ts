import { Body, Controller, Delete, ForbiddenException, HttpCode, Param, Post } from '@nestjs/common';
import { RegisterPushDeviceSchema, type Principal, type RegisterPushDeviceDto } from '@repo/shared-types';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { CurrentPrincipal, Roles } from '../../modules/auth/presentation/decorators.js';

// Devices belong to the caller's own account, so the principal (not @TenantId) decides the owner.
@Controller('push/devices')
@Roles('SuperAdmin', 'TenantAdmin', 'User')
export class PushDevicesController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @HttpCode(204)
  async register(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(RegisterPushDeviceSchema)) { token }: RegisterPushDeviceDto,
  ): Promise<void> {
    const owner = userOf(principal);
    // A device that signs in to another account now belongs to that account.
    await this.prisma.pushDevice.upsert({ where: { token }, create: { token, ...owner }, update: owner });
  }

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
