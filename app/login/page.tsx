import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession, SESSION_COOKIE } from '@/app/lib/session';
import LoginForm from './LoginForm';

// A visitor who still holds a valid session shouldn't be shown a login form — bookmarking
// /login, or reopening the tab weeks later, should drop them straight into the scanner.
// The form itself stays a client component; this wrapper just does the cookie check.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const store = await cookies();
  if (await verifySession(store.get(SESSION_COOKIE)?.value)) redirect('/scan');

  const { expired } = await searchParams;
  return <LoginForm expired={expired === '1'} />;
}
