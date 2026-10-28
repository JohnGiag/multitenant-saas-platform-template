'use server';

import { LocaleSchema } from '@repo/shared-types';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE } from '@/lib/i18n';

const YEAR_S = 365 * 24 * 60 * 60;

export async function setLocale(locale: string): Promise<void> {
  (await cookies()).set(LOCALE_COOKIE, LocaleSchema.parse(locale), {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: YEAR_S,
  });
  revalidatePath('/', 'layout');
}
