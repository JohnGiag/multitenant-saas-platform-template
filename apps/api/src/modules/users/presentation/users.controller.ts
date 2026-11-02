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
  cursorPage,
  UpdateUserSchema,
  UserExportSchema,
  UserPageQuerySchema,
  UserSchema,
  type ChangePasswordDto,
  type CursorPage,
  type Principal,
  type UpdateUserDto,
  type User,
  type UserExport,
  type UserPageQuery,
} from '@repo/shared-types';
import { ApiDoc } from '../../../common/api-doc.js';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { ACCESS_REVOCATIONS, type AccessRevocations } from '../../auth/domain/ports/access-revocations.port.js';
import { CurrentPrincipal, Roles, SelfService } from '../../auth/presentation/decorators.js';
import { RATE_LIMITER, type RateLimiter } from '../../rate-limit/domain/ports/rate-limiter.port.js';
import { passwordChangeKey } from '../../rate-limit/domain/rate-limit-policy.js';
import { clearAccountAttempts, countOwnAttempt } from '../../rate-limit/presentation/account-attempts.js';
import { TenantId } from '../../tenancy/presentation/tenant-context.js';
import { USER_REPOSITORY, type UserRepository } from '../domain/ports/user.repository.js';
import { LocalAuthOnly } from '../../auth/presentation/local-auth-only.js';

// Members of the current tenant (a SuperAdmin picks the tenant with X-Tenant-Id). New members join
// through invitations (InvitationsController), so nobody but the user ever chooses their password.
@Controller('users')
@Roles('SuperAdmin', 'TenantAdmin')
export class UsersController {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(ACCESS_REVOCATIONS) private readonly revocations: AccessRevocations,
  ) {}

  @Roles('SuperAdmin', 'TenantAdmin', 'Auditor')
  @ApiDoc('List the members of the current tenant', cursorPage(UserSchema))
  @Get()
  list(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(UserPageQuerySchema)) query: UserPageQuery,
  ): Promise<CursorPage<User>> {
    return this.users.list(tenantId, query);
  }

  // For a data subject's request, which reaches the tenant: its admins' business, not a SuperAdmin's.
  @Roles('TenantAdmin')
  @ApiDoc("Export a member's records: profile and sessions (`cursor` and `limit` page the sessions). Their actions are in GET /v1/audit-logs?actorId=", UserExportSchema)
  @Get(':id/export')
  async export(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(UserPageQuerySchema)) query: UserPageQuery,
  ): Promise<UserExport> {
    const records = await this.users.exportRecords(tenantId, id, query);
    if (!records) throw new NotFoundException();
    return records;
  }

  @ApiDoc("Change a member's role (never to or from SuperAdmin; a tenant keeps at least one TenantAdmin, else 409)", UserSchema)
  @Patch(':id')
  async update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateUserSchema)) { role }: UpdateUserDto,
  ): Promise<User> {
    const user = orFail(await this.users.updateRole(tenantId, id, role));
    // Their session stays: the next refresh brings the new role, and the old one stops working now.
    await this.revocations.revoke('user', user.id);
    return user;
  }

  @LocalAuthOnly()
  @ApiDoc('Remove a member and their account (never the last TenantAdmin)')
  @Delete(':id')
  @HttpCode(204)
  async remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    orFail(await this.users.remove(tenantId, id));
    await this.revocations.revoke('user', id);
  }

  // The caller's own account, so the principal (not @TenantId) decides whose password this is.
  @Roles('SuperAdmin', 'TenantAdmin', 'User', 'Auditor')
  @SelfService()
  @LocalAuthOnly()
  @ApiDoc('Change your own password; wrong guesses count towards the sign-in limit. Every session ends, this one too: sign in again')
  @Put('me/password')
  @HttpCode(204)
  async changePassword(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(ChangePasswordSchema)) body: ChangePasswordDto,
    @Res({ passthrough: true }) res: { setHeader(name: string, value: number): void },
  ): Promise<void> {
    if (principal.kind !== 'user') throw new ForbiddenException('Only users have passwords');
    const key = passwordChangeKey(principal.tenantId, principal.id);
    await countOwnAttempt(this.limiter, key, res);
    const result = await this.users.changePassword(
      principal.tenantId,
      principal.id,
      body.currentPassword,
      body.newPassword,
    );
    if (result === 'no_password') throw new ConflictException('This account signs in through an external provider');
    if (result === 'wrong_password') throw new BadRequestException('Current password is incorrect');
    await this.revocations.revoke('user', principal.id);
    await clearAccountAttempts(this.limiter, key);
  }
}

function orFail<T>(result: T | 'not_found' | 'protected' | 'last_admin'): T {
  if (result === 'not_found') throw new NotFoundException();
  if (result === 'protected') throw new ForbiddenException('SuperAdmin accounts are managed outside the tenant API');
  if (result === 'last_admin') throw new ConflictException('A tenant must keep at least one TenantAdmin');
  return result;
}
