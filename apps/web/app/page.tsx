import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Entry point. We resolve the user once and route them to the right
 * place so refreshing `/` always lands on the screen they expect:
 *
 *   - no session       → /login
 *   - signed in, new   → /onboarding
 *   - signed in, ready → /dashboard
 */
export default async function RootPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  redirect(user.onboardedAt ? '/dashboard' : '/onboarding');
}
