import Link from 'next/link';

// Keyset pagination only moves forward; "First page" starts over.
export function Pager({ next, first, label }: { next: string | null | undefined; first: string | undefined; label: string }) {
  if (!next && !first) return null;
  return (
    <nav aria-label={`Pages of ${label}`} className="mt-4 flex gap-4 text-sm">
      {first && (
        <Link href={first} className="underline underline-offset-4">
          First page
        </Link>
      )}
      {next && (
        <Link href={next} className="underline underline-offset-4">
          Next page
        </Link>
      )}
    </nav>
  );
}
