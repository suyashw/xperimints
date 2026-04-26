'use server';

import { getCurrentOrg } from '@/lib/data';

const API = process.env.INTERNAL_API_URL ?? 'http://localhost:3001';

/**
 * Minimal view of the recorded draft used by the /experiments/new page
 * to render a "Recorded as draft experiment → /experiments/{id}" banner.
 * Only the fields the UI actually reads are typed — the API returns the
 * full Experiment row (with `result`, etc.) but we don't surface the
 * extra detail here so the contract stays narrow.
 */
interface RecordedExperimentSummary {
  id: string;
  name: string;
  status: string;
  shareSlug: string;
  treatmentUrl: string;
  // True iff the API actually inserted a row; false when an existing
  // experiment for this prompt was returned (idempotent path). The UI
  // uses this to switch between "Recorded as draft" / "Tracking
  // existing draft" copy.
  created: boolean;
}

type RecordImplementResult =
  | { ok: true; data: RecordedExperimentSummary }
  | { ok: false; error: string };

/**
 * Records the user's "Implement experiment" click as a DRAFT row in the
 * Experiments table so it shows up on /experiments. Idempotent on the
 * API side — calling this on every render of /experiments/new for the
 * same promptId is safe.
 *
 * Returns the recorded experiment summary on success and a friendly
 * error string on failure (which the caller renders inline rather than
 * throwing — landing on /experiments/new should never 500 just because
 * the draft record couldn't be created).
 */
export async function recordImplementExperiment(
  promptId: string,
): Promise<RecordImplementResult> {
  if (!promptId) return { ok: false, error: 'promptId is required' };
  const org = await getCurrentOrg();
  if (!org) {
    return { ok: false, error: 'No workspace for this account. Please log in again.' };
  }
  try {
    const res = await fetch(`${API}/v1/experiments/draft-from-prompt`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-peec-lab-org': org.id,
      },
      body: JSON.stringify({ promptId }),
      cache: 'no-store',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `API ${res.status}: ${text.slice(0, 240)}` };
    }
    const json = (await res.json()) as {
      created: boolean;
      experiment: {
        id: string;
        name: string;
        status: string;
        shareSlug: string;
        treatmentUrl: string;
      };
    };
    return {
      ok: true,
      data: {
        id: json.experiment.id,
        name: json.experiment.name,
        status: json.experiment.status,
        shareSlug: json.experiment.shareSlug,
        treatmentUrl: json.experiment.treatmentUrl,
        created: json.created,
      },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
