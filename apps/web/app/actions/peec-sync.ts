'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentOrg } from '@/lib/data';

const API = process.env.INTERNAL_API_URL ?? 'http://localhost:3001';

interface PeecStatus {
  mode: 'live' | 'disconnected';
  baseUrl: string;
}

export interface PeecSyncResultSummary {
  ok: boolean;
  mode?: 'live' | 'disconnected';
  projectName?: string;
  promptCount?: number;
  brandCount?: number;
  modelCount?: number;
  topicCount?: number;
  tagCount?: number;
  snapshotsCaptured?: number;
  experimentsRefreshed?: number;
  durationMs?: number;
  error?: string;
}

export async function getPeecStatus(): Promise<PeecStatus | null> {
  const org = await getCurrentOrg();
  // Header is optional — the API falls back to a global lookup when it's
  // absent. We only ever omit it on screens that run before login.
  const headers: HeadersInit = org ? { 'x-peec-lab-org': org.id } : {};
  try {
    const res = await fetch(`${API}/v1/peec/status`, {
      cache: 'no-store',
      headers,
    });
    if (!res.ok) return null;
    return (await res.json()) as PeecStatus;
  } catch {
    return null;
  }
}

export interface PeecProjectChoice {
  id: string;
  name: string;
  status: string | null;
}

type ListProjectsResult =
  | { ok: true; projects: PeecProjectChoice[] }
  | { ok: false; error: string };

/**
 * Live `list_projects` against the user's connected Peec workspace.
 * Backs the onboarding picker so the user can pick which Peec project
 * Xperimints should attach to before any local cache is written.
 */
export async function listPeecProjects(): Promise<ListProjectsResult> {
  const org = await getCurrentOrg();
  if (!org) {
    return { ok: false, error: 'No workspace for this account. Please log in again.' };
  }
  try {
    const res = await fetch(`${API}/v1/peec/projects`, {
      method: 'GET',
      headers: { 'x-peec-lab-org': org.id },
      cache: 'no-store',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `API ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = (await res.json()) as
      | { ok: true; projects: PeecProjectChoice[] }
      | { ok: false; error: string };
    if (!json.ok) return { ok: false, error: json.error };
    return { ok: true, projects: json.projects };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * User-triggered Peec sync. Bypasses the 5-min throttle that gates
 * `ensurePeecFresh()` so the dashboard refresh button always does work.
 * The API persists everything (PeecProject row + analytics caches) before
 * returning, so the subsequent `revalidatePath('/dashboard')` already sees
 * the new rows on re-render.
 *
 * Pass `peecProjectId` to pin the sync to a specific upstream Peec
 * project — used by the onboarding picker. Omit to let the API fall
 * back to the first row from `list_projects` (the Refresh button on
 * the dashboard does this).
 */
export async function triggerPeecSync(opts: {
  peecProjectId?: string;
} = {}): Promise<PeecSyncResultSummary> {
  const org = await getCurrentOrg();
  if (!org) {
    return { ok: false, error: 'No workspace for this account. Please log in again.' };
  }
  try {
    const res = await fetch(`${API}/v1/peec/sync`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-peec-lab-org': org.id,
      },
      body: JSON.stringify(
        opts.peecProjectId ? { peecProjectId: opts.peecProjectId } : {},
      ),
      cache: 'no-store',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `API ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = (await res.json()) as
      | { ok: false; error: string }
      | {
          ok: true;
          mode: 'live' | 'disconnected';
          peecProject: {
            name: string;
            promptCount: number;
            brandCount: number;
            modelCount: number;
            topicCount: number;
            tagCount: number;
          } | null;
          snapshotsCaptured: number;
          experimentsRefreshed: Array<unknown>;
          durationMs: number;
        };
    if (!json.ok) {
      return { ok: false, error: json.error };
    }
    revalidatePath('/dashboard');
    revalidatePath('/experiments');
    return {
      ok: true,
      mode: json.mode,
      projectName: json.peecProject?.name,
      promptCount: json.peecProject?.promptCount,
      brandCount: json.peecProject?.brandCount,
      modelCount: json.peecProject?.modelCount,
      topicCount: json.peecProject?.topicCount,
      tagCount: json.peecProject?.tagCount,
      snapshotsCaptured: json.snapshotsCaptured,
      experimentsRefreshed: json.experimentsRefreshed.length,
      durationMs: json.durationMs,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
