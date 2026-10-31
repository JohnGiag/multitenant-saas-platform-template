import { ServiceUnavailableException } from '@nestjs/common';
import { TimedOutError } from './with-timeout.js';

// For controllers: `.catch(unavailableOnTimeout)` answers 503 instead of 500 when a queue could not be reached.
export function unavailableOnTimeout(error: unknown): never {
  if (error instanceof TimedOutError) throw new ServiceUnavailableException('The job queue is unavailable; try again');
  throw error;
}
