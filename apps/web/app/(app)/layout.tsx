import { requireOnboardedUser } from '@/lib/auth';
import { Navbar } from './_components/navbar';

export const dynamic = 'force-dynamic';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Auth + onboarding gate. Anyone without a session is bounced to
  // /login; signed-in but un-onboarded users go to /onboarding so the
  // Peec connection step happens before they ever see a dashboard
  // that's missing data.
  const user = await requireOnboardedUser();

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar
        user={{
          email: user.email,
          name: user.name,
        }}
      />
      <main className="flex-1">{children}</main>
    </div>
  );
}
