import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { HealthSchema, type Health } from '@repo/shared-types';
import type { Redis } from 'ioredis';
import { ApiDoc } from '../../../common/api-doc.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.module.js';
import { Public } from '../../auth/presentation/decorators.js';
import { FailOpen } from '../../rate-limit/presentation/fail-open.js';

// A database that accepts the connection but never answers would otherwise hold the probe until it times out.
const CHECK_TIMEOUT_MS = 2000;

// For load balancers and orchestrators. Liveness never touches a dependency, so an outage of Postgres or Redis
// takes instances out of rotation (readiness) without restarting them all.
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Public()
  @FailOpen()
  @ApiDoc('Liveness: the process is up. Checks nothing else', HealthSchema)
  @Get()
  live(): Health {
    return { status: 'ok' };
  }

  @Public()
  @FailOpen()
  @ApiDoc('Readiness: Postgres and Redis answer. 503 names what is down', HealthSchema)
  @Get('ready')
  async ready(): Promise<Health> {
    const checks = { database: this.prisma.$queryRaw`SELECT 1`, redis: this.redis.ping() };
    const results = await Promise.all(Object.values(checks).map((check) => withTimeout(check).then(() => true, () => false)));
    const down = Object.keys(checks).filter((_, i) => !results[i]);
    // Names only: error messages can carry hostnames and connection details.
    if (down.length > 0) throw new ServiceUnavailableException(`Not ready: ${down.join(', ')}`);
    return { status: 'ok' };
  }
}

function withTimeout(check: Promise<unknown>): Promise<unknown> {
  return Promise.race([check, new Promise((_, reject) => setTimeout(reject, CHECK_TIMEOUT_MS).unref())]);
}
