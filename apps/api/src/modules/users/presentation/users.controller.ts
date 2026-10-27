import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  ChangePasswordSchema,
  UpdateUserSchema,
  UserPageQuerySchema,
  type ChangePasswordDto,
  type CursorPage,
  type Principal,
  type UpdateUserDto,
  type User,
  type UserPageQuery,
} from '@repo/shared-types';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { CurrentPrincipal, Roles, SelfService } from '../../auth/presentation/decorators.js';
import { RATE_LIMITER, type RateLimiter } from '../../rate-limit/domain/ports/rate-limiter.port.js';
import { passwordChangeKey } from '../../rate-limit/domain/rate-limit-policy.js';
import { clearAccountAttempts, countAccountAttempt } from '../../rate-limit/presentation/account-attempts.js';
import { TenantId } from '../../tenancy/presentation/tenant-context.js';
import { USER_REPOSITORY, type UserRepository } from '../domain/ports/user.repository.js';

// Members of the current tenant (a SuperAdmin picks the tenant with X-Tenant-Id). New members join
// through invitations (InvitationsController), so nobody but the user ever chooses their password.
@Controller('users')
@Roles('SuperAdmin', 'TenantAdmin')
export class UsersController {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  @Roles('SuperAdmin', 'TenantAdmin', 'Auditor')
  @Get()
  list(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(UserPageQuerySchema)) query: UserPageQuery,
  ): Promise<CursorPage<User>> {
    return this.users.list(tenantId, query);
  }

  @Patch(':id')
  async update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateUserSchema)) { role }: UpdateUserDto,
  ): Promise<User> {
    return orFail(await this.users.updateRole(tenantId, id, role));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    orFail(await this.users.remove(tenantId, id));
  }

  // The caller's own account, so the principal (not @TenantId) decides whose password this is.
  @Roles('SuperAdmin', 'TenantAdmin', 'User', 'Auditor')
  @SelfService()
  @Put('me/password')
  @HttpCode(204)
  async changePassword(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(ChangePasswordSchema)) body: ChangePasswordDto,
    @Res({ passthrough: true }) res: { setHeader(name: string, value: number): void },
  ): Promise<void> {
    if (principal.kind !== 'user') throw new ForbiddenException('Only users have passwords');
    const key = passwordChangeKey(principal.tenantId, principal.id);
    await countAccountAttempt(this.limiter, key, res);
    const result = await this.users.changePassword(
      principal.tenantId,
      principal.id,
      body.currentPassword,
      body.newPassword,
    );
    if (result === 'no_password') throw new ConflictException('This account signs in through an external provider');
    if (result === 'wrong_password') throw new BadRequestException('Current password is incorrect');
    await clearAccountAttempts(this.limiter, key);
  }
}

function orFail<T>(result: T | 'not_found' | 'protected' | 'last_admin'): T {
  if (result === 'not_found') throw new NotFoundException();
  if (result === 'protected') throw new ForbiddenException('SuperAdmin accounts are managed outside the tenant API');
  if (result === 'last_admin') throw new ConflictException('A tenant must keep at least one TenantAdmin');
  return result;
}
