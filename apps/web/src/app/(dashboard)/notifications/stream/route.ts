import { API_URL, TIMEOUT_MS } from '@/lib/api';
import { getToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Relays the caller's own SSE stream. The browser's EventSource sends the session cookie to this same-origin
// route, which adds the bearer token the API needs; the token itself never reaches page scripts.
export async function GET(request: Request): Promise<Response> {
  const token = await getToken();
  if (!token) return new Response(null, { status: 401 });

  // A timeout until the stream opens only: once open it lives until either side closes it.
  const connecting = new AbortController();
  const timer = setTimeout(() => connecting.abort(), TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/v1/notifications/stream`, {
      headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
      // The browser leaving aborts the API request too, so the API frees its stream slot.
      signal: AbortSignal.any([request.signal, connecting.signal]),
      cache: 'no-store',
    });
  } catch {
    return new Response(null, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
  // Any non-200 makes EventSource give up instead of reconnecting (e.g. an expired session).
  if (!upstream.ok || !upstream.body) return new Response(null, { status: upstream.status === 401 ? 401 : 502 });
  return new Response(upstream.body, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' },
  });
}
