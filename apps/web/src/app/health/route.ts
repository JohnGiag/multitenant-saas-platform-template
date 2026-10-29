export const dynamic = 'force-dynamic';

// Liveness for load balancers and the container's HEALTHCHECK: this server is up. It never calls the API, so an
// API outage does not get dashboard instances restarted too.
export function GET(): Response {
  return Response.json({ status: 'ok' });
}
