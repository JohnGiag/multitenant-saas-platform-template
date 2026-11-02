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
  AcceptedInvitationSchema,
  AcceptInvitationSchema,
  CreateInvitationSchema,
  cursorPage,
  InvitationPageQuerySchema,
  InvitationSchema,
  type AcceptedInvitation,
  type AcceptInvitationDto,
  type CreateInvitationDto,
  type CursorPage,
  type Invitation,
  type InvitationPageQuery,
} from '@repo/shared-types';
import { ApiDoc } from '../../../common/api-doc.js';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { Public, RequireScope, Roles } from '../../auth/presentation/decorators.js';
import { Idempotent } from '../../idempotency/presentation/idempotency.guard.js';
import { LiveOnly, TenantId } from '../../tenancy/presentation/tenant-context.js';
import { INVITATION_SERVICE, type InvitationService } from '../domain/ports/invitation.service.js';
import { rethrowMailError } from './mail-errors.js';
import { LocalAuthOnly } from '../../auth/presentation/local-auth-only.js';

// Users join only by invitation (a SuperAdmin picks the tenant with X-Tenant-Id). Invitations always
// go out with the platform's email credentials, so no tenant can read the link and accept it.
@LocalAuthOnly()
@Controller('invitations')
@LiveOnly()
@RequireScope()
@Roles('SuperAdmin', 'TenantAdmin')
export class InvitationsController {
  constructor(@Inject(INVITATION_SERVICE) private readonly invitations: InvitationService) {}

  @Roles('SuperAdmin', 'TenantAdmin', 'Auditor')
  @ApiDoc('List pending invitations', cursorPage(InvitationSchema))
  @Get()
  list(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(InvitationPageQuerySchema)) query: InvitationPageQuery,
  ): Promise<CursorPage<Invitation>> {
    return this.invitations.list(tenantId, query);
  }

  @ApiDoc(
    'Invite someone: emails a single-use link valid for 7 days, always with the platform credentials. Re-inviting the same email replaces the pending invitation',
    InvitationSchema,
  )
  @Idempotent()
  @Post()
  async invite(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(CreateInvitationSchema)) body: CreateInvitationDto,
  ): Promise<Invitation> {
    const result = await this.invitations.invite(tenantId, body).catch(rethrowMailError);
    if (result === 'already_member') throw new ConflictException('This email already belongs to a member of the tenant');
    return result;
  }

  @ApiDoc('Send a fresh link; the old one stops working', InvitationSchema)
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

  @ApiDoc('Revoke a pending invitation')
  @Delete(':id')
  @HttpCode(204)
  async revoke(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    if (!(await this.invitations.revoke(tenantId, id))) throw new NotFoundException();
  }

  // Public: the invitee has no account yet. The token from the email is the credential.
  @Public()
  @ApiDoc("Accept an invitation with the emailed token and choose a password: creates the account", AcceptedInvitationSchema)
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
