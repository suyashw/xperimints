'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentOrg } from '@/lib/data';

const API = process.env.INTERNAL_API_URL ?? 'http://localhost:3001';

export type IntegrationType = 'PEEC' | 'GITHUB' | 'VERCEL' | 'LINEAR';
type IntegrationStatus = 'ACTIVE' | 'NEEDS_REAUTH' | 'DISABLED' | 'NOT_CONNECTED';

export interface IntegrationCardView {
  type: IntegrationType;
  status: IntegrationStatus;
  connectedAt: string | null;
  updatedAt: string | null;
  account: string | null;
  config: Record<string, unknown>;
}

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function withOrgHeaders(): Promise<HeadersInit | null> {
  const org = await getCurrentOrg();
  if (!org) return null;
  return {
    'content-type': 'application/json',
    'x-peec-lab-org': org.id,
  };
}

const NO_ORG_ERROR = 'No workspace for this account. Please log in again.';

export async function listIntegrationsAction(): Promise<
  ActionResult<IntegrationCardView[]>
> {
  const headers = await withOrgHeaders();
  if (!headers) return { ok: false, error: NO_ORG_ERROR };
  try {
    const res = await fetch(`${API}/v1/integrations`, { headers, cache: 'no-store' });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `API ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as IntegrationCardView[];
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function connectIntegrationAction(
  type: IntegrationType,
  credentials: Record<string, string>,
  config?: Record<string, unknown>,
): Promise<ActionResult<IntegrationCardView>> {
  const headers = await withOrgHeaders();
  if (!headers) return { ok: false, error: NO_ORG_ERROR };
  try {
    const res = await fetch(`${API}/v1/integrations/${type}/connect`, {
      method: 'POST',
      headers,
      cache: 'no-store',
      body: JSON.stringify({ credentials, config }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { message?: string } | null;
      const text = json?.message ?? (await res.text().catch(() => '')) ?? `HTTP ${res.status}`;
      return { ok: false, error: typeof text === 'string' ? text : JSON.stringify(text) };
    }
    const data = (await res.json()) as IntegrationCardView;
    revalidatePath('/integrations');
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function testIntegrationAction(
  type: IntegrationType,
): Promise<ActionResult<IntegrationCardView>> {
  const headers = await withOrgHeaders();
  if (!headers) return { ok: false, error: NO_ORG_ERROR };
  try {
    const res = await fetch(`${API}/v1/integrations/${type}/test`, {
      method: 'POST',
      headers,
      cache: 'no-store',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: text.slice(0, 200) || `HTTP ${res.status}` };
    }
    const data = (await res.json()) as IntegrationCardView;
    revalidatePath('/integrations');
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function disconnectIntegrationAction(
  type: IntegrationType,
): Promise<ActionResult<{ ok: true }>> {
  const headers = await withOrgHeaders();
  if (!headers) return { ok: false, error: NO_ORG_ERROR };
  try {
    const res = await fetch(`${API}/v1/integrations/${type}`, {
      method: 'DELETE',
      headers,
      cache: 'no-store',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: text.slice(0, 200) || `HTTP ${res.status}` };
    }
    revalidatePath('/integrations');
    return { ok: true, data: { ok: true } };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
