import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getBuzzAccount, getMe } from '@/lib/civitai';
import { getOnboarding } from '@/lib/onboarding';
import { getSession } from '@/lib/session';
import { shellUserFromMe } from '@/lib/user';
import { getUserKey } from '@/lib/userKey';
import { FaroIdentity } from '@/components/FaroIdentity';
import { RouteTransition } from '@/components/shell/RouteTransition';
import { SessionKeepAlive } from '@/components/shell/SessionKeepAlive';
import { AppShellProvider } from './AppShellContext';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/');

  const userKey = await getUserKey(session);
  const onboarding = await getOnboarding(userKey);
  if (!onboarding.completedAt) {
    redirect(`/onboarding/${onboarding.currentStep}`);
  }

  let buzzBalance: number | undefined;
  let user;
  try {
    const [me, buzz] = await Promise.all([getMe(session), getBuzzAccount(session)]);
    buzzBalance = buzz?.balance;
    user = shellUserFromMe(me);
  } catch {
    user = shellUserFromMe(null);
  }

  return (
    <AppShellProvider buzzBalance={buzzBalance} user={user}>
      <FaroIdentity userKey={userKey} />
      <SessionKeepAlive />
      <RouteTransition>{children}</RouteTransition>
    </AppShellProvider>
  );
}
