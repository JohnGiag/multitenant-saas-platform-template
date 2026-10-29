import { SetMetadata } from '@nestjs/common';

export const FAIL_OPEN_KEY = 'rateLimit:failOpen';

// A public route that must keep answering while Redis is down (health probes): still metered per IP when Redis
// is up, but let through unmetered in an outage instead of answering 503. Never for routes that check a secret.
export const FailOpen = () => SetMetadata(FAIL_OPEN_KEY, true);
