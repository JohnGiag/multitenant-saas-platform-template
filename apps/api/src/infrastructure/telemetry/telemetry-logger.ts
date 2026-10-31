import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import { logs, SeverityNumber } from '@opentelemetry/api';

const SEVERITY: Record<LogLevel, SeverityNumber> = {
  verbose: SeverityNumber.TRACE,
  debug: SeverityNumber.DEBUG,
  log: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
  fatal: SeverityNumber.FATAL,
};

// Console output as before, and each message over OTLP too, tied to the active trace. Without telemetry.js the logger
// below does nothing. Stack traces stay on the console: they can quote user input.
export class TelemetryLogger extends ConsoleLogger {
  private readonly otel = logs.getLogger('api');

  protected override printMessages(
    messages: unknown[],
    context = '',
    logLevel: LogLevel = 'log',
    writeStreamType?: 'stdout' | 'stderr',
    errorStack?: unknown,
    params?: Record<string, any>,
  ): void {
    super.printMessages(messages, context, logLevel, writeStreamType, errorStack, params);
    for (const message of messages) {
      this.otel.emit({
        severityNumber: SEVERITY[logLevel],
        severityText: logLevel,
        body: typeof message === 'string' ? message : JSON.stringify(message),
        attributes: { 'log.context': context },
      });
    }
  }
}
