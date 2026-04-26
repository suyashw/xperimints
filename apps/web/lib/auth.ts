import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT, jwtVerify } from 'jose';
import { prisma } from '@peec-lab/database';

/**
 * Cookie + JWT-based session for the in-app email/password flow.
 *
 * Storage model: a single signed JWT in an HttpOnly cookie. The token
 * carries only the `userId` — every protected page re-fetches the user
 * (and their org membership) from the DB so revoked / deleted users
 * lose access on the next render rather than waiting for the token to
 * expire.
 *
 * Crypto: HS256 over `AUTH_SECRET`. We deliberately *don't* fall back
 * to a hardcoded secret in production — `getSessionSecret()` throws so
 * an unconfigured deploy fails loud rather than silently signing
 * tokens with a known string.
 */

const SESSION_COOKIE = 'peec_lab_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const ISSUER = 'peec-lab';
const AUDIENCE = 'peec-lab-web';

let cachedKey: Uint8Array | null = null;

function getSessionSecret(): Uint8Array {
  if (cachedKey) return cachedKey;
  const raw = process.env.AUTH_SECRET;
  if (!raw || raw.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'AUTH_SECRET must be set to at least 32 chars in production. Generate with `openssl rand -hex 32`.',
      );
    }
    // Dev fallback. The 32-char minimum keeps HS256 happy and the value
    // is stable so existing dev sessions survive a server restart.
    cachedKey = new TextEncoder().encode(
      'peec-lab-dev-secret-change-me-please-32chars-minimum',
    );
    return cachedKey;
  }
  cachedKey = new TextEncoder().encode(raw);
  return cachedKey;
}

interface SessionPayload {
  userId: string;
}

export async function signSessionToken(userId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_TTL_SECONDS)
    .sign(getSessionSecret());
}

async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload.userId !== 'string') return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}

export async function setSessionCookie(userId: string): Promise<void> {
  const token = await signSessionToken(userId);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/**
 * Resolve the calling user from the session cookie (or null if none).
 * Includes the user's first organization membership so callers can scope
 * org-level data without a second round-trip.
 */
export async function getSessionUser() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    include: {
      memberships: {
        include: { organization: true },
        orderBy: { id: 'asc' },
        take: 1,
      },
    },
  });
  if (!user) return null;
  return user;
}

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;

/**
 * Used inside the `(app)` route group: anybody without a session lands
 * on `/login`, anybody who hasn't finished onboarding lands on
 * `/onboarding`. Returns the user (with membership) on success.
 */
export async function requireOnboardedUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!user.onboardedAt) redirect('/onboarding');
  return user;
}

/**
 * Used inside `(onboarding)`: requires a session but allows users who
 * haven't finished onboarding yet. Already-onboarded users get bounced
 * to `/dashboard` so they don't land on the welcome screen by accident
 * after refreshing the URL.
 */
export async function requireUserAllowingOnboarding(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.onboardedAt) redirect('/dashboard');
  return user;
}

/**
 * Used inside `(auth)`: signed-in users skip login/signup and go to
 * wherever they belong (dashboard if onboarded, onboarding otherwise).
 */
export async function redirectIfAuthenticated(): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;
  redirect(user.onboardedAt ? '/dashboard' : '/onboarding');
}
