'use server';

import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';
import { prisma } from '@peec-lab/database';
import {
  clearSessionCookie,
  getSessionUser,
  setSessionCookie,
} from '@/lib/auth';

export interface AuthFormState {
  ok: false;
  error: string;
  /** Echo back the email so the form doesn't lose it on a failed submit. */
  email?: string;
}

const PASSWORD_MIN = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readField(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Build a deterministic, URL-safe org slug from an email + suffix. We
 * avoid raw uniqueness collisions by appending a short random suffix
 * (the slug column is unique). Two signups from the same email can't
 * happen (the email column is also unique) so this is just to keep
 * slugs readable + globally distinct across the table.
 */
function deriveOrgSlug(email: string): string {
  const local = email.split('@')[0] ?? 'team';
  const cleaned = local
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'team';
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${cleaned}-${suffix}`;
}

/**
 * Build a friendly default org name from the email's local part. Users
 * never see the slug; this is what shows up on the dashboard header
 * until they connect Peec (at which point the project name takes over).
 */
function deriveOrgName(email: string, fallback: string): string {
  const local = email.split('@')[0] ?? '';
  const friendly = local
    .replace(/[._-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  if (friendly.length > 0) return `${friendly}'s workspace`;
  return fallback;
}

export async function signupAction(
  _prev: AuthFormState | undefined,
  formData: FormData,
): Promise<AuthFormState> {
  const name = readField(formData, 'name');
  const email = readField(formData, 'email').toLowerCase();
  const password = readField(formData, 'password');

  if (!email || !EMAIL_RE.test(email)) {
    return { ok: false, error: 'Enter a valid email address.', email };
  }
  if (password.length < PASSWORD_MIN) {
    return {
      ok: false,
      error: `Password must be at least ${PASSWORD_MIN} characters.`,
      email,
    };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return {
      ok: false,
      error: 'An account with this email already exists. Try logging in.',
      email,
    };
  }

  const passwordHash = await bcrypt.hash(password, 10);

  // Create the user, their personal org, and the OWNER membership in a
  // single transaction so a half-provisioned account can't ever land
  // on the dashboard with no org behind it. Each user gets their *own*
  // organization — there is no shared single-tenant org any more, so
  // Peec connections, integrations, and experiments are scoped per
  // account out of the box.
  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name: name.length > 0 ? name : null,
        passwordHash,
      },
    });
    const org = await tx.organization.create({
      data: {
        slug: deriveOrgSlug(email),
        name: deriveOrgName(email, name.length > 0 ? `${name}'s workspace` : 'My workspace'),
      },
    });
    await tx.membership.create({
      data: { userId: user.id, organizationId: org.id, role: 'OWNER' },
    });
    return user;
  });

  await setSessionCookie(created.id);

  // New signup → drop them into the onboarding flow (Peec connection).
  // `onboardedAt` stays null until they finish or skip onboarding.
  redirect('/onboarding');
}

export async function loginAction(
  _prev: AuthFormState | undefined,
  formData: FormData,
): Promise<AuthFormState> {
  const email = readField(formData, 'email').toLowerCase();
  const password = readField(formData, 'password');

  if (!email || !password) {
    return { ok: false, error: 'Email and password are required.', email };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  // Run the bcrypt compare even when the user is missing so the response
  // time doesn't leak whether the email exists. The hash being checked
  // here will always fail.
  const hashToCheck =
    user?.passwordHash ?? '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali';
  const ok = await bcrypt.compare(password, hashToCheck);
  if (!user || !user.passwordHash || !ok) {
    return { ok: false, error: 'Incorrect email or password.', email };
  }

  await setSessionCookie(user.id);

  redirect(user.onboardedAt ? '/dashboard' : '/onboarding');
}

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect('/login');
}

/**
 * Marks the current user as having finished onboarding and bounces them
 * to the dashboard. Called from the onboarding page both when the user
 * successfully connects Peec and when they choose "Skip for now".
 */
export async function completeOnboardingAction(): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!user.onboardedAt) {
    await prisma.user.update({
      where: { id: user.id },
      data: { onboardedAt: new Date() },
    });
  }
  redirect('/dashboard');
}
