import { lookup as dnsLookup, type LookupAddress, type LookupAllOptions, type LookupOneOptions } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { isPublicAddress } from '../domain/address-policy.js';

// A hung receiver would otherwise hold a worker slot for minutes; a timeout is retried like a 5xx.
const TIMEOUT_MS = 10_000;

// The URL leads somewhere webhooks may not go (see address-policy.ts): a retry would only be refused again.
export class BlockedAddressError extends Error {}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

// Resolves like the default, then refuses the connection if any address is not public. Hooked into the request
// itself, so the address checked is the one connected to: a hostname that resolves to a public address when saved
// and to an internal one later (DNS rebinding) is still refused.
function guardedLookup(hostname: string, options: LookupOneOptions | LookupAllOptions, callback: LookupCallback): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const refused = addresses.find((a) => !isPublicAddress(a.address));
    if (refused) return callback(new BlockedAddressError(`${hostname} resolves to ${refused.address}, which is not a public address`), []);
    if (options.all) return callback(null, addresses);
    const [first] = addresses;
    if (!first) return callback(new BlockedAddressError(`${hostname} has no address`), []);
    callback(null, first.address, first.family);
  });
}

// POSTs the body and answers the response status. Redirects are not followed (a 3xx is just a failed delivery), and
// the response body is discarded unread. `allowPrivate` (local development only) lifts the address check and allows http.
export function postWebhook(url: URL, headers: Record<string, string>, body: string, allowPrivate: boolean): Promise<number> {
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) {
    return Promise.reject(new BlockedAddressError(`${url.protocol} URLs are not allowed`));
  }
  // An address written in the URL is connected to without any lookup, so it is checked here.
  const literal = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate && isIP(literal) !== 0 && !isPublicAddress(literal)) {
    return Promise.reject(new BlockedAddressError(`${literal} is not a public address`));
  }
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<number>((resolve, reject) => {
    const req = send(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        ...(!allowPrivate && { lookup: guardedLookup }),
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}
