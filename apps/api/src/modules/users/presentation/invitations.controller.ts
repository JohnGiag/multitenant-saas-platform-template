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
  Post,
  Query,
} from '@nestjs/common';
import {
  AcceptInvitationSchema,
  CreateInvitationSchema,
  InvitationPageQuerySchema,
  type AcceptedInvitation,
  type AcceptInvitationDto,
  type CreateInvitationDto,
  type CursorPage,
  type Invitation,
  type InvitationPageQuery,
} from '@repo/shared-types';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { Public, Roles } from '../../auth/presentation/decorators.js';
import { TenantId } from '../../tenancy/presentation/tenant-context.js';
import { INVITATION_SERVICE, type InvitationService } from '../domain/ports/invitation.service.js';
import { rethrowMailError } from './mail-errors.js';
import { LocalAuthOnly } from '../../auth/presentation/local-auth-only.js';

// Users join only by invitation (a SuperAdmin picks the tenant with X-Tenant-Id). Invitations always
// go out with the platform's email credentials, so no tenant can read the link and accept it.
@LocalAuthOnly()
@Controller('invitations')
@Roles('SuperAdmin', 'TenantAdmin')
export class InvitationsController {
  constructor(@Inject(INVITATION_SERVICE) private readonly invitations: InvitationService) {}

  @Roles('SuperAdmin', 'TenantAdmin', 'Auditor')
  @Get()
  list(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(InvitationPageQuerySchema)) query: InvitationPageQuery,
  ): Promise<CursorPage<Invitation>> {
    return this.invitations.list(tenantId, query);
  }

  @Post()
  async invite(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(CreateInvitationSchema)) body: CreateInvitationDto,
  ): Promise<Invitation> {
    const result = await this.invitations.invite(tenantId, body).catch(rethrowMailError);
    if (result === 'already_member') throw new ConflictException('This email already belongs to a member of the tenant');
    return result;
  }

  @Post(':id/resend')
  @HttpCode(200)
  async resend(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Invitation> {
    const invitation = await this.invitations.resend(tenantId, id).catch(rethrowMailError);
    if (!invitation) throw new NotFoundException();
    return invitation;
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    if (!(await this.invitations.revoke(tenantId, id))) throw new NotFoundException();
  }

  // Public: the invitee has no account yet. The token from the email is the credential.
  @Public()
  @Post('accept')
  async accept(
    @Body(new ZodValidationPipe(AcceptInvitationSchema)) { token, password }: AcceptInvitationDto,
  ): Promise<AcceptedInvitation> {
    const result = await this.invitations.accept(token, password);
    if (result === 'invalid') throw new BadRequestException('This invitation is invalid or has expired');
    if (result === 'already_member') throw new ConflictException('This email already belongs to a member of the tenant');
    return result;
  }
}
