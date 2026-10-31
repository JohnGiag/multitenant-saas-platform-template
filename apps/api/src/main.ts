import { createApp } from './app.js';
import { TelemetryLogger } from './infrastructure/telemetry/telemetry-logger.js';

const app = await createApp({ bufferLogs: true });
app.useLogger(new TelemetryLogger());
app.enableShutdownHooks();
await app.listen(process.env.PORT ?? 3000);
