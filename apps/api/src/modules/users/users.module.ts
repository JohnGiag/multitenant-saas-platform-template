import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { INVITATION_SERVICE } from './domain/ports/invitation.service.js';
import { PASSWORD_RESET_SERVICE } from './domain/ports/password-reset.service.js';
import { USER_REPOSITORY } from './domain/ports/user.repository.js';
import { PrismaInvitationService } from './infrastructure/prisma-invitation.service.js';
import { PrismaPasswordResetService } from './infrastructure/prisma-password-reset.service.js';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository.js';
import { InvitationsController } from './presentation/invitations.controller.js';
import { PasswordResetController } from './presentation/password-reset.controller.js';
import { UsersController } from './presentation/users.controller.js';

@Module({
  imports: [RateLimitModule, MailModule],
  controllers: [UsersController, InvitationsController, PasswordResetController],
  providers: [
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: INVITATION_SERVICE, useClass: PrismaInvitationService },
    { provide: PASSWORD_RESET_SERVICE, useClass: PrismaPasswordResetService },
  ],
})
export class UsersModule {}
