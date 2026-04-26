'use server';

import { getCurrentOrg } from '@/lib/data';

const API = process.env.INTERNAL_API_URL ?? 'http://localhost:3001';

export interface EngineRow {
  model_id: string;
  visibility: number;
  share_of_voice?: number;
}

/**
 * Narrative paragraphs + curated citations behind the hypothesis. Surfaced
 * by the "View research" modal on /experiments/new so the user can see
 * *why* the recommendation was made before committing to a PR.
 *
 * Mirrors `ResearchBundle` in apps/api/src/modules/peec/prompt-hypothesis.service.ts.
 * Citation URLs are always picked from a closed library on the API side
 * — never user-supplied or LLM-invented — so the modal can render them
 * as plain `<a target="_blank">` links without sanitisation work.
 */
export interface ResearchCitation {
  tag: string;
  title: string;
  url: string;
  domain: string;
  note: string;
}

interface ResearchBundle {
  narrative: string[];
  citations: ResearchCitation[];
}

/**
 * Mirrors `ActionItem` in
 * apps/api/src/modules/peec/prompt-hypothesis.service.ts. Powers section
 * 3 ("Recommended actions") on /experiments/new — each entry renders as
 * one structured card describing a concrete content change a marketer
 * can ship (FAQ block to add, blog to publish, schema markup, etc.).
 */
export type ActionKind =
  | 'faq'
  | 'blog'
  | 'content_update'
  | 'schema_markup'
  | 'comparison_table'
  | 'citations'
  | 'new_landing_page'
  | 'internal_linking'
  | 'author_bio'
  | 'other';

export type ActionPriority = 'high' | 'medium' | 'low';
export type ActionEffort = 'small' | 'medium' | 'large';

export interface ActionItem {
  // Stable id (`${promptId}:${kind}:${slug}`) computed server-side. Used
  // as the storage key for generated content and as the body parameter
  // sent to /v1/peec/actions/generate.
  id: string;
  kind: ActionKind;
  title: string;
  description: string;
  priority: ActionPriority;
  effort: ActionEffort;
  expectedImpact: string;
  target?: string;
  steps: string[];
  examples?: string[];
}

/** AI-generated artefact for a single action card. Mirrors
 * `ActionGeneration` in apps/api/src/modules/peec/prompt-hypothesis.service.ts. */
export interface ActionGeneration {
  actionId: string;
  actionKind: ActionKind;
  content: string;
  format: 'markdown' | 'json' | 'text';
  createdAt: string;
  updatedAt: string;
}

export interface PromptHypothesisResult {
  promptId: string;
  promptText: string | null;
  overallVisibility: number | null;
  engineBreakdown: EngineRow[];
  weakEngines: string[];
  strongEngines: string[];
  hypothesis: string;
  recommendedTreatment: string;
  suggestedExperimentName: string;
  recommendedMinLiftPp: number;
  research: ResearchBundle;
  actionPlan: ActionItem[];
  generations: Record<string, ActionGeneration>;
  source: 'openai' | 'heuristic';
  // ISO timestamp from the cache row (or `now()` for a fresh compute).
  // Surfaced as "Last analyzed at …" in the modal.
  computedAt: string;
  // True when the response was served from PromptHypothesisCache without
  // any upstream Peec MCP / OpenAI call.
  cached: boolean;
}

type PromptHypothesisActionResult =
  | { ok: true; data: PromptHypothesisResult }
  | { ok: false; error: string };

/**
 * Backs the prompt-inspector modal on the dashboard. Round-trips through
 * the NestJS API (which owns the Peec MCP token + the OpenAI call + the
 * PromptHypothesisCache row) so we don't have to duplicate Peec auth in
 * the web tier.
 *
 * The API caches results in `PromptHypothesisCache` keyed by
 * (organizationId, promptId). Default behaviour (`force` omitted/false)
 * returns the cached row when one exists — that's what makes opening the
 * modal repeatedly free. Pass `force: true` from the modal's "Re-analyze"
 * button to bypass the cache, recompute, and overwrite the row.
 */
export async function analyzePromptHypothesis(
  promptId: string,
  options: { force?: boolean } = {},
): Promise<PromptHypothesisActionResult> {
  if (!promptId || promptId.length === 0) {
    return { ok: false, error: 'promptId is required' };
  }
  const org = await getCurrentOrg();
  if (!org) {
    return { ok: false, error: 'No workspace for this account. Please log in again.' };
  }
  try {
    const res = await fetch(`${API}/v1/peec/prompts/hypothesis`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-peec-lab-org': org.id,
      },
      body: JSON.stringify({
        promptId,
        ...(options.force ? { force: true } : {}),
      }),
      cache: 'no-store',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `API ${res.status}: ${text.slice(0, 240)}`,
      };
    }
    const data = (await res.json()) as PromptHypothesisResult;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

type GenerateActionResult =
  | { ok: true; data: ActionGeneration }
  | { ok: false; error: string };

/**
 * Backs the per-action "Generate" button on /experiments/new.
 *
 * Round-trips through the NestJS API which owns the OpenAI call + the
 * `ActionGenerationCache` upsert. Returns the freshly generated body
 * (always non-empty on success — the API uses a templated heuristic
 * fallback when OpenAI is unavailable). The caller updates its local
 * state with the returned generation and the next page load picks it
 * up via `analyzePromptHypothesis()` because the API attaches all
 * persisted generations to the response.
 */
export async function generateActionContent(
  promptId: string,
  actionId: string,
): Promise<GenerateActionResult> {
  if (!promptId) return { ok: false, error: 'promptId is required' };
  if (!actionId) return { ok: false, error: 'actionId is required' };
  const org = await getCurrentOrg();
  if (!org) {
    return { ok: false, error: 'No workspace for this account. Please log in again.' };
  }
  try {
    const res = await fetch(`${API}/v1/peec/actions/generate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-peec-lab-org': org.id,
      },
      body: JSON.stringify({ promptId, actionId }),
      cache: 'no-store',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `API ${res.status}: ${text.slice(0, 240)}`,
      };
    }
    const data = (await res.json()) as ActionGeneration;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
