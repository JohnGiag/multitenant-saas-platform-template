import { Body, Controller, Get, HttpCode, Inject, Post, UnauthorizedException } from '@nestjs/common';
import { SignInSchema, type AuthToken, type Principal, type SignInDto } from '@repo/shared-types';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { AUTH_SERVICE, type AuthService } from '../domain/ports/auth.port.js';
import { CurrentPrincipal, Public, Roles } from './decorators.js';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AUTH_SERVICE) private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodValidationPipe(SignInSchema)) body: SignInDto): Promise<AuthToken> {
    const token = await this.auth.signIn(body);
    if (!token) throw new UnauthorizedException('Invalid credentials');
    return token;
  }

  @Roles('SuperAdmin', 'TenantAdmin', 'User', 'Auditor')
  @Get('me')
  me(@CurrentPrincipal() principal: Principal): Principal {
    return principal;
  }
}
