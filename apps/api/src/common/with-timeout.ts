export class TimedOutError extends Error {}

// Stops waiting, not the work: a queue command held back by a Redis outage still runs when Redis returns. For calls
// that wait out outages (BullMQ connections do, from any state) where a request must not.
export function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimedOutError(`${what} took over ${ms} ms`)), ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}
