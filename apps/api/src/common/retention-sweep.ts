import { Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';

const EVERY_MS = 60 * 60 * 1000;

// Deletes rows past their retention, at startup and then hourly. A timer rather than a job: it has no tenant to put in a
// payload, needs no Redis, and running on every instance at once only finds nothing left to delete. A retention sweep
// deletes by age alone (see CLAUDE.md): it reads nothing and returns nothing. UsageFlush shares the timer, not that rule.
export abstract class RetentionSweep implements OnApplicationBootstrap, OnModuleDestroy {
  protected readonly logger = new Logger(this.constructor.name);
  private timer?: NodeJS.Timeout;
  private running: Promise<void> = Promise.resolve();
  protected readonly everyMs: number = EVERY_MS;

  protected abstract sweep(): Promise<unknown>;

  onApplicationBootstrap(): void {
    this.run();
    this.timer = setInterval(() => this.run(), this.everyMs);
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  private run(): void {
    this.running = this.sweep().then(
      () => undefined,
      (err: unknown) => this.logger.error(`Sweep failed, will run again: ${err instanceof Error ? err.message : String(err)}`),
    );
  }
}
