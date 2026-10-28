import Link from 'next/link';
import { getT } from '@/lib/i18n';

// Keyset pagination only moves forward; "First page" starts over. `label` names the list, already translated.
export async function Pager({ next, first, label }: { next: string | null | undefined; first: string | undefined; label: string }) {
  if (!next && !first) return null;
  const t = await getT();
  return (
    <nav aria-label={t('common.pagesOf', { label })} className="mt-4 flex gap-4 text-sm">
      {first && (
        <Link href={first} className="underline underline-offset-4">
          {t('common.firstPage')}
        </Link>
      )}
      {next && (
        <Link href={next} className="underline underline-offset-4">
          {t('common.nextPage')}
        </Link>
      )}
    </nav>
  );
}
