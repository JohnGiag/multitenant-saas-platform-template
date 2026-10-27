import { ConflictException, Injectable, UseGuards, type CanActivate } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LocalAuthOnlyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    if (this.config.get<string>('AUTH_PROVIDER') === 'clerk') {
      throw new ConflictException('Managed in Clerk for this deployment');
    }
    return true;
  }
}

// Routes Clerk takes over when AUTH_PROVIDER=clerk: sign-in, passwords, invitations, and creating or
// removing tenants and members (those happen in Clerk and arrive through its webhooks).
export const LocalAuthOnly = () => UseGuards(LocalAuthOnlyGuard);
