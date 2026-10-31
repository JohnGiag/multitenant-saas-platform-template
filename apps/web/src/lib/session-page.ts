// The request's own page, told to server code by proxy.ts: pages cannot read their URL.
export const PAGE_HEADER = 'x-dashboard-page';

const SELF = 'http://local';

// A path on this site, whatever `next` says. Parsed rather than pattern-matched: URL parsers drop tabs and newlines,
// so "/<tab>/evil.com" would pass a check on the raw text and then lead to evil.com.
export function localPath(next: string): string {
  if (!URL.canParse(next, SELF)) return '/';
  const url = new URL(next, SELF);
  return url.origin === SELF ? url.pathname + url.search : '/';
}
