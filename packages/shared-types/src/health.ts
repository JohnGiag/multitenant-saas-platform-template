import { z } from 'zod';

// GET /v1/health (the process is up) and GET /v1/health/ready (it can reach Postgres and Redis). A failed check
// answers 503 instead, naming what is down.
export const HealthSchema = z.object({ status: z.literal('ok') });
export type Health = z.infer<typeof HealthSchema>;
