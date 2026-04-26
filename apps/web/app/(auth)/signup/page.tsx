import Link from 'next/link';
import { SignupForm } from './signup-form';

export const metadata = {
  title: 'Sign up · Xperimints',
};

export default function SignupPage() {
  return (
    <div className="rounded-2xl border border-[color:var(--color-border)] bg-white p-8 shadow-sm">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">
          Create your account
        </h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          Start running AI-visibility experiments in minutes.
        </p>
      </header>

      <SignupForm />

      <p className="mt-6 text-center text-xs text-[color:var(--color-muted)]">
        Already have an account?{' '}
        <Link
          href="/login"
          className="font-medium text-[color:var(--color-accent)] underline-offset-2 hover:underline"
        >
          Log in
        </Link>
      </p>
    </div>
  );
}
