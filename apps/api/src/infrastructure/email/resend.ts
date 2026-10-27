const RESEND_URL = 'https://api.resend.com/emails';

export interface ResendEmail {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  // Resend drops a repeat with the same key, so a retry after a timeout sends no second email.
  idempotencyKey?: string;
}

export type ResendResult =
  // Resend's email id: GET /emails/{id} reports its delivery status.
  | { ok: true; id: string }
  // `detail` is short and log-safe: Resend's error body never echoes the API key.
  | { ok: false; status: number; detail: string };

// The one place the Resend API is called (system emails and the optional email channel).
export async function sendWithResend(email: ResendEmail): Promise<ResendResult> {
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${email.apiKey}`,
      'content-type': 'application/json',
      ...(email.idempotencyKey && { 'idempotency-key': email.idempotencyKey }),
    },
    body: JSON.stringify({ from: email.from, to: [email.to], subject: email.subject, text: email.text }),
    // A hung Resend would otherwise hold a worker slot for undici's 5-minute default; a timeout is retried.
    signal: AbortSignal.timeout(10_000),
  });
  if (res.ok) return { ok: true, id: ((await res.json()) as { id: string }).id };
  return { ok: false, status: res.status, detail: `Resend answered ${res.status}: ${(await res.text()).slice(0, 300)}` };
}

// Rate limited or down: worth retrying. Anything else (bad key, unverified sender) will not heal.
export const isRetryableStatus = (status: number) => status === 429 || status >= 500;
