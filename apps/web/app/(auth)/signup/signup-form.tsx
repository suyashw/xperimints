'use client';

import { useActionState } from 'react';
import { signupAction, type AuthFormState } from '@/app/actions/auth';

const initialState: AuthFormState | undefined = undefined;

export function SignupForm() {
  const [state, formAction, isPending] = useActionState(
    signupAction,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Field
        name="name"
        type="text"
        label="Name"
        autoComplete="name"
        placeholder="Ada Lovelace"
        helper="Optional — shown in the app header."
      />
      <Field
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        defaultValue={state?.email ?? ''}
        placeholder="you@company.com"
        required
      />
      <Field
        name="password"
        type="password"
        label="Password"
        autoComplete="new-password"
        placeholder="At least 8 characters"
        required
        minLength={8}
      />

      {state && !state.ok && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800"
        >
          {state.error}
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-[color:var(--color-accent)] px-4 py-2 text-sm font-medium text-[color:var(--color-accent-fg)] hover:opacity-90 disabled:opacity-50"
      >
        {isPending ? 'Creating account…' : 'Create account'}
      </button>

      <p className="text-center text-[11px] text-[color:var(--color-muted)]">
        By signing up you agree that this is a hackathon demo and your
        data may be reset at any time.
      </p>
    </form>
  );
}

function Field({
  name,
  label,
  type,
  placeholder,
  autoComplete,
  defaultValue,
  required,
  minLength,
  helper,
}: {
  name: string;
  label: string;
  type: string;
  placeholder?: string;
  autoComplete?: string;
  defaultValue?: string;
  required?: boolean;
  minLength?: number;
  helper?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-[color:var(--color-fg)]">
        {label}
        {!required && (
          <span className="ml-1 text-[10px] font-normal text-[color:var(--color-muted)]">
            (optional)
          </span>
        )}
      </span>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        required={required}
        minLength={minLength}
        className="mt-1 block w-full rounded-md border border-[color:var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)]"
      />
      {helper && (
        <span className="mt-1 block text-[11px] text-[color:var(--color-muted)]">
          {helper}
        </span>
      )}
    </label>
  );
}
