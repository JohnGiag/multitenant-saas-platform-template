import { createHash, createHmac } from 'node:crypto';

export interface PresignRequest {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  // Only the origin is used, e.g. https://<account>.r2.cloudflarestorage.com.
  endpoint: string;
  // Unencoded, e.g. "/<bucket>/<key>" (path-style addressing, which R2 and S3 both accept).
  path: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresIn: number;
  // Extra signed query parameters, e.g. response-content-disposition.
  query?: Record<string, string>;
  // Extra signed headers (lowercase names) the request must send with exactly these values,
  // e.g. content-length to fix an upload's size.
  headers?: Record<string, string>;
  now: Date;
}

// AWS Signature V4 in the query string, as S3-compatible stores accept for presigned URLs: signs the host
// (plus any extra headers) and leaves the payload unsigned. https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
export function presignS3Url(r: PresignRequest): string {
  const { origin, host } = new URL(r.endpoint);
  const amzDate = r.now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${r.region}/s3/aws4_request`;
  const path = r.path.split('/').map(encode).join('/');
  const headers = sortByName(Object.entries({ ...r.headers, host }));
  const signedHeaders = headers.map(([name]) => name).join(';');
  const query = sortByName(
    Object.entries({
      ...r.query,
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${r.accessKeyId}/${scope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(r.expiresIn),
      'X-Amz-SignedHeaders': signedHeaders,
    }).map(([name, value]) => [encode(name), encode(value)]),
  )
    .map(([name, value]) => `${name}=${value}`)
    .join('&');

  const canonicalHeaders = headers.map(([name, value]) => `${name}:${value}\n`).join('');
  const canonicalRequest = [r.method, path, query, canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const signingKey = [date, r.region, 's3', 'aws4_request'].reduce<Buffer | string>(
    (key, part) => createHmac('sha256', key).update(part).digest(),
    `AWS4${r.secretAccessKey}`,
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return `${origin}${path}?${query}&X-Amz-Signature=${signature}`;
}

function sortByName(entries: string[][]): string[][] {
  return entries.sort(([a], [b]) => (a! < b! ? -1 : 1));
}

// RFC 3986: everything but A-Z a-z 0-9 - _ . ~ is percent-encoded, as SigV4 requires.
function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
