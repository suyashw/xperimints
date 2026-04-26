import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@peec-lab/database';
import { decodeRows } from '@peec-lab/mcp-clients';

import { PRISMA } from '../../prisma/prisma.module.js';
import { PeecMcpService } from './peec-mcp.service.js';

// (research bundle support added in apps/web's experiment-implementer revamp;
// the citation library lives at the bottom of this file.)

/**
 * Per-prompt deep-dive used by the dashboard's prompt-inspector modal.
 * Two layered concerns:
 *
 *   1. Engine breakdown — answers "which LLMs is THIS prompt visible on?".
 *      We fetch get_brand_report({ dimensions: ['model_id'], filters:
 *      [prompt_id in [<id>]] }) on demand instead of caching it; one
 *      call per modal-open is cheap and avoids bloating the sync.
 *
 *   2. Hypothesis — turns the breakdown into a one-paragraph
 *      "if we did X, we'd expect a Y-pp lift on Z engines" recommendation
 *      that the user can implement as an experiment with one click.
 *      Uses an OpenAI call when OPENAI_API_KEY is set; otherwise falls back
 *      to a deterministic heuristic that still produces useful output from
 *      the visibility numbers alone (so the demo works key-less).
 *
 * Both concerns are cached together in `PromptHypothesisCache` keyed by
 * (organizationId, promptId). The first click on a prompt computes and
 * upserts the row; subsequent clicks read the row directly. Only the
 * "Re-analyze" button sends `force: true`, which bypasses the cache,
 * recomputes, and overwrites the row. This keeps the modal snappy on
 * repeat opens and also keeps OpenAI / Peec MCP costs bounded to what
 * the user explicitly asked for.
 */

export interface EngineRow {
  model_id: string;
  visibility: number;
  share_of_voice?: number;
}

/**
 * Research bundle backing the hypothesis — surfaced by the
 * "Implement experiment" page in a "View research" modal so the user can
 * inspect *why* the recommendation was made before committing to a PR.
 *
 * `narrative` is a small list of paragraphs walking through the reasoning
 * chain (data → diagnosis → treatment → expected effect). Each entry maps
 * to one paragraph in the modal — keeping it as an array (not a single
 * string) avoids the UI having to invent paragraph breaks from an LLM
 * blob and keeps the structure stable across the OpenAI / heuristic paths.
 *
 * `citations` are picked from a small in-process library of canonical GEO
 * sources keyed by `tag` (see `CITATION_LIBRARY` below). We never let the
 * LLM emit free-form URLs — it can only pick tags from the library, which
 * eliminates hallucinated links and keeps the demo deterministic.
 */
interface ResearchCitation {
  // Stable tag used as React `key` and as the LLM's selection token.
  tag: string;
  title: string;
  url: string;
  domain: string;
  // One-sentence explanation of *why this source backs the hypothesis*.
  // The library carries a default; the OpenAI path can override it with a
  // recommendation-specific note.
  note: string;
}

interface ResearchBundle {
  narrative: string[];
  citations: ResearchCitation[];
}

/**
 * Structured AI action-plan that powers section 3 of /experiments/new.
 *
 * Each `ActionItem` is one concrete thing a marketer can ship: an FAQ
 * block to publish, a blog post to write, schema markup to add, etc.
 * The shape is deliberately rich (steps, examples, expectedImpact) so
 * the UI can render scannable cards without the user having to interpret
 * a free-form recommendation paragraph.
 *
 * `kind` is constrained to a small closed set so the UI can pick a stable
 * icon / colour / heading per category and so the LLM can't drift into
 * inventing categories that the UI doesn't know how to render.
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

type ActionPriority = 'high' | 'medium' | 'low';
type ActionEffort = 'small' | 'medium' | 'large';

export interface ActionItem {
  // Stable, deterministic identifier for this action — `${promptId}:${kind}:${slug(title)}`
  // (truncated to 200 chars). Used as the storage key for the per-action
  // "Generate" button output, so generations survive cache writes/reads
  // and even survive a `Re-analyze` as long as the kind+title pair is
  // stable. Computed server-side via `actionIdFor()` for both the
  // OpenAI path and the heuristic fallback, so the UI never sees an
  // ActionItem without an id.
  id: string;
  kind: ActionKind;
  title: string;
  description: string;
  priority: ActionPriority;
  effort: ActionEffort;
  expectedImpact: string;
  // Optional URL or page identifier the action targets (e.g.
  // "/blog/best-llm-tools" or "Pricing page"). When omitted the UI hides
  // the row instead of showing an empty value.
  target?: string;
  // 3-6 concrete sub-tasks the marketer can check off. Free-form text;
  // the UI renders them as a checklist.
  steps: string[];
  // Optional 1-3 concrete content samples (FAQ Q&A pairs, blog headline
  // candidates, comparison-table rows, JSON-LD snippet, etc).
  examples?: string[];
}

/**
 * One AI-generated artefact attached to a single ActionItem (FAQ Q&A
 * list, blog draft, JSON-LD snippet, etc). Persisted in
 * `ActionGenerationCache` so reloads keep the user's previously
 * generated content. Always 1:1 with an ActionItem via `actionId`.
 */
export interface ActionGeneration {
  actionId: string;
  actionKind: ActionKind;
  content: string;
  // Hint for the UI's clipboard / renderer. We don't bother with a full
  // syntax-highlighter — the value just toggles between rendering the
  // content as a markdown-ish `<pre>` (json) or a plain prose block.
  format: 'markdown' | 'json' | 'text';
  createdAt: string;
  updatedAt: string;
}

interface PromptHypothesisResult {
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
  // Detailed structured plan rendered as the main payload of section 3
  // on /experiments/new. 2-5 concrete actions ordered from highest to
  // lowest priority. Always populated — falls back to a deterministic
  // heuristic when OpenAI is unavailable or returns a malformed plan.
  actionPlan: ActionItem[];
  // Map from `ActionItem.id` → previously persisted ActionGeneration.
  // Hydrated from `ActionGenerationCache` on every analyze() call so the
  // page renders generated content directly on first paint after reloads.
  // Empty object (not null) when nothing has been generated yet — keeps
  // the UI's lookup code branch-free.
  generations: Record<string, ActionGeneration>;
  // Where the hypothesis text came from. Useful for the UI's "powered by"
  // micro-copy and for tests that want to assert deterministic output.
  source: 'openai' | 'heuristic';
  // ISO timestamp of when this hypothesis was computed. Lets the UI render
  // "Last analyzed at …" so users know whether they're looking at a cached
  // result or a fresh one. Always populated server-side — either from the
  // cache row's `computedAt` or `new Date().toISOString()` on a fresh
  // compute.
  computedAt: string;
  // True when the response came from the PromptHypothesisCache row (no
  // upstream Peec MCP / OpenAI calls were made on this request). Lets the
  // UI distinguish "freshly analyzed" from "loaded from cache" without
  // exposing the cache schema.
  cached: boolean;
}

interface EngineRowFromPeec extends Record<string, unknown> {
  brand_id?: string;
  model_id?: string;
  visibility?: number;
  share_of_voice?: number;
}

@Injectable()
export class PromptHypothesisService {
  private readonly logger = new Logger(PromptHypothesisService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly peec: PeecMcpService,
  ) {}

  async analyze(
    organizationId: string,
    promptId: string,
    options: { force?: boolean } = {},
  ): Promise<PromptHypothesisResult> {
    const force = options.force === true;

    // Cache hit short-circuits before we do any work — including the
    // `peecProject` lookup. The cached row is the entire response shape,
    // so this stays a single Prisma round-trip on the hot path.
    if (!force) {
      const cached = await this.readCache(organizationId, promptId);
      if (cached) return cached;
    }

    const project = await this.prisma.peecProject.findFirst({
      where: { organizationId },
      orderBy: { lastSyncedAt: 'desc' },
    });
    if (!project) {
      throw new NotFoundException(
        'No Peec project synced yet. Run a Peec sync first from the dashboard.',
      );
    }

    const promptText = this.lookupPromptText(project.cachedPrompts, promptId);
    const overallVisibility = this.lookupOverallVisibility(
      project.cachedPromptVisibility,
      promptId,
    );

    const peecClient = await this.peec.getClient();
    if (!peecClient) {
      // Fall back gracefully: even without a live Peec we can still produce
      // a hypothesis from the cached overall visibility number. We still
      // upsert this so the next open is instant even when Peec is offline.
      const heuristic = this.buildHeuristic({
        promptText,
        overallVisibility,
        engineBreakdown: [],
      });
      return this.writeCache(organizationId, {
        promptId,
        promptText,
        overallVisibility,
        engineBreakdown: [],
        ...heuristic,
        research: this.buildHeuristicResearch({
          promptText,
          overallVisibility,
          engineBreakdown: [],
          recommendedTreatment: heuristic.recommendedTreatment,
        }),
        actionPlan: this.buildHeuristicActionPlan({
          promptId,
          promptText,
          overallVisibility,
          engineBreakdown: [],
          recommendedTreatment: heuristic.recommendedTreatment,
        }),
        source: 'heuristic',
      });
    }

    const ownBrandId = await this.resolveOwnBrandId(project.id, project.name);
    const today = new Date();
    const startDate = isoDate(addDays(today, -14));
    const endDate = isoDate(today);

    let engineBreakdown: EngineRow[] = [];
    try {
      const report = await peecClient.getBrandReport({
        project_id: project.peecProjectId,
        start_date: startDate,
        end_date: endDate,
        dimensions: ['model_id'],
        filters: [{ field: 'prompt_id', operator: 'in', values: [promptId] }],
      });
      const rows = decodeRows<EngineRowFromPeec>(report);
      engineBreakdown = rows
        .filter(
          (r) =>
            // Restrict to own brand when we know it; otherwise return everything
            // and let the UI filter (covers projects where is_own resolution
            // is still ambiguous).
            !ownBrandId || !r.brand_id || r.brand_id === ownBrandId,
        )
        .filter(
          (r): r is EngineRowFromPeec & { model_id: string } =>
            typeof r.model_id === 'string' && r.model_id.length > 0,
        )
        .map((r) => ({
          model_id: r.model_id,
          visibility: typeof r.visibility === 'number' ? r.visibility : 0,
          share_of_voice:
            typeof r.share_of_voice === 'number' ? r.share_of_voice : undefined,
        }))
        .sort((a, b) => b.visibility - a.visibility);
    } catch (err) {
      this.logger.warn(
        `get_brand_report (prompt+model) failed for ${promptId}: ${(err as Error).message}`,
      );
    }

    const aiHypothesis = await this.tryOpenAi({
      promptId,
      promptText,
      overallVisibility,
      engineBreakdown,
    });
    if (aiHypothesis) {
      return this.writeCache(organizationId, {
        promptId,
        promptText,
        overallVisibility,
        engineBreakdown,
        ...aiHypothesis,
        source: 'openai',
      });
    }
    const heuristic = this.buildHeuristic({
      promptText,
      overallVisibility,
      engineBreakdown,
    });
    return this.writeCache(organizationId, {
      promptId,
      promptText,
      overallVisibility,
      engineBreakdown,
      ...heuristic,
      research: this.buildHeuristicResearch({
        promptText,
        overallVisibility,
        engineBreakdown,
        recommendedTreatment: heuristic.recommendedTreatment,
      }),
      actionPlan: this.buildHeuristicActionPlan({
        promptId,
        promptText,
        overallVisibility,
        engineBreakdown,
        recommendedTreatment: heuristic.recommendedTreatment,
      }),
      source: 'heuristic',
    });
  }

  /**
   * Returns a cached PromptHypothesisResult if one exists for this
   * (organizationId, promptId). Returns null on cache miss or on a row
   * that fails the shape guard (defensive: a corrupted JSON blob shouldn't
   * brick the modal — we'll just recompute).
   */
  private async readCache(
    organizationId: string,
    promptId: string,
  ): Promise<PromptHypothesisResult | null> {
    const row = await this.prisma.promptHypothesisCache.findUnique({
      where: { organizationId_promptId: { organizationId, promptId } },
    });
    if (!row) return null;
    if (!row.result || typeof row.result !== 'object') return null;
    const stored = row.result as Record<string, unknown>;
    // Backfill the research bundle for cache rows written before the
    // research feature shipped. We synthesise from the same heuristic the
    // fresh path uses, so the modal always has something to show without
    // forcing the user to re-analyze every prompt after the upgrade.
    const research =
      isResearchBundle(stored.research)
        ? stored.research
        : this.buildHeuristicResearch({
            promptText: (stored.promptText as string | null) ?? null,
            overallVisibility:
              typeof stored.overallVisibility === 'number'
                ? (stored.overallVisibility as number)
                : null,
            engineBreakdown: Array.isArray(stored.engineBreakdown)
              ? (stored.engineBreakdown as EngineRow[])
              : [],
            recommendedTreatment:
              typeof stored.recommendedTreatment === 'string'
                ? (stored.recommendedTreatment as string)
                : '',
          });
    // Same pattern as `research`: cache rows written before the
    // structured action-plan shipped won't have `actionPlan`. Synthesise
    // it from the same heuristic the fresh path uses so the UI never
    // renders an empty section, without forcing a recompute.
    const actionPlan = isActionPlan(stored.actionPlan)
      ? stored.actionPlan
      : this.buildHeuristicActionPlan({
          promptId,
          promptText: (stored.promptText as string | null) ?? null,
          overallVisibility:
            typeof stored.overallVisibility === 'number'
              ? (stored.overallVisibility as number)
              : null,
          engineBreakdown: Array.isArray(stored.engineBreakdown)
            ? (stored.engineBreakdown as EngineRow[])
            : [],
          recommendedTreatment:
            typeof stored.recommendedTreatment === 'string'
              ? (stored.recommendedTreatment as string)
              : '',
        });
    const generations = await this.fetchGenerations(
      organizationId,
      actionPlan.map((a) => a.id),
    );
    return {
      ...(stored as unknown as PromptHypothesisResult),
      research,
      actionPlan,
      generations,
      // Always rehydrate transient fields from the row itself, not the
      // stored JSON, so they stay accurate even if older rows wrote a
      // different shape.
      computedAt: row.computedAt.toISOString(),
      cached: true,
    };
  }

  /**
   * Upserts the freshly computed result and returns it with the canonical
   * `cached: false` + server-side `computedAt` so the response shape
   * stays uniform with the cache-hit path.
   */
  private async writeCache(
    organizationId: string,
    fresh: Omit<PromptHypothesisResult, 'computedAt' | 'cached' | 'generations'>,
  ): Promise<PromptHypothesisResult> {
    const computedAt = new Date();
    // Persist the lean payload (no `cached`/`computedAt` — those are
    // rehydrated from the row), so a future schema migration to those
    // fields stays additive.
    await this.prisma.promptHypothesisCache.upsert({
      where: {
        organizationId_promptId: {
          organizationId,
          promptId: fresh.promptId,
        },
      },
      create: {
        organizationId,
        promptId: fresh.promptId,
        result: fresh as unknown as Prisma.InputJsonValue,
        computedAt,
      },
      update: {
        result: fresh as unknown as Prisma.InputJsonValue,
        computedAt,
      },
    });
    // Attach any pre-existing generations so a `Re-analyze` doesn't wipe
    // the user's previously generated content from the UI. If the new
    // plan happens to share `actionId`s with the old one (same kind +
    // title), those generations are reused; new actions just start with
    // no generation and the user can hit Generate.
    const generations = await this.fetchGenerations(
      organizationId,
      fresh.actionPlan.map((a) => a.id),
    );
    return {
      ...fresh,
      computedAt: computedAt.toISOString(),
      cached: false,
      generations,
    };
  }

  /**
   * Loads existing generations for a set of action ids in one query,
   * keyed by `actionId` for O(1) lookup in the UI. Returns an empty
   * object for an empty input (avoids a wasted round-trip on action
   * plans that produced no items, which shouldn't happen but is cheap
   * to defend against).
   */
  private async fetchGenerations(
    organizationId: string,
    actionIds: string[],
  ): Promise<Record<string, ActionGeneration>> {
    if (actionIds.length === 0) return {};
    const rows = await this.prisma.actionGenerationCache.findMany({
      where: {
        organizationId,
        actionId: { in: actionIds },
      },
    });
    const out: Record<string, ActionGeneration> = {};
    for (const row of rows) {
      out[row.actionId] = {
        actionId: row.actionId,
        actionKind: row.actionKind as ActionKind,
        content: row.content,
        format: normaliseFormat(row.format),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    }
    return out;
  }

  private async resolveOwnBrandId(projectInternalId: string, projectName: string): Promise<string | null> {
    const project = await this.prisma.peecProject.findUnique({
      where: { id: projectInternalId },
      select: { cachedBrandTotals: true },
    });
    if (!project) return null;
    const rows = decodeColumnar<{
      brand_id?: string;
      brand_name?: string;
      is_own?: boolean;
      share_of_voice?: number;
    }>(project.cachedBrandTotals);
    const normalized = projectName.trim().toLowerCase();
    const own =
      rows.find((r) => r.is_own === true) ??
      rows.find(
        (r) =>
          typeof r.brand_name === 'string' &&
          r.brand_name.trim().toLowerCase() === normalized,
      ) ??
      rows.sort((a, b) => (b.share_of_voice ?? 0) - (a.share_of_voice ?? 0))[0];
    return own?.brand_id ?? null;
  }

  private lookupPromptText(cachedPrompts: unknown, promptId: string): string | null {
    const rows = decodeColumnar<{
      id?: string;
      text?: string;
      prompt?: string;
      content?: string;
      messages?: Array<{ content?: unknown }> | string;
    }>(cachedPrompts);
    const row = rows.find((r) => r.id === promptId);
    if (!row) return null;
    if (typeof row.text === 'string' && row.text.length > 0) return row.text;
    if (typeof row.prompt === 'string' && row.prompt.length > 0) return row.prompt;
    if (typeof row.content === 'string' && row.content.length > 0) return row.content;
    if (Array.isArray(row.messages)) {
      for (const m of row.messages) {
        if (m && typeof m.content === 'string' && m.content.length > 0) return m.content;
      }
    } else if (typeof row.messages === 'string' && row.messages.length > 0) {
      return row.messages;
    }
    return null;
  }

  private lookupOverallVisibility(
    cachedPromptVisibility: unknown,
    promptId: string,
  ): number | null {
    const rows = decodeColumnar<{
      prompt_id?: string;
      visibility?: number;
    }>(cachedPromptVisibility);
    // Each prompt can appear once per brand; the dashboard already filters
    // to the own-brand row, so we sum any matches as a defensive average.
    const matching = rows.filter((r) => r.prompt_id === promptId);
    if (matching.length === 0) return null;
    const sum = matching.reduce((acc, r) => acc + (r.visibility ?? 0), 0);
    return sum / matching.length;
  }

  private async tryOpenAi(input: {
    promptId: string;
    promptText: string | null;
    overallVisibility: number | null;
    engineBreakdown: EngineRow[];
  }): Promise<Omit<PromptHypothesisResult,
    'promptId' | 'promptText' | 'overallVisibility' | 'engineBreakdown' | 'source' | 'computedAt' | 'cached' | 'generations'> | null
  > {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    const userPrompt = this.buildLlmUserPrompt(input);
    // The model is allowed to pick from `citationTags` (a closed list of
    // tags from CITATION_LIBRARY) but never to invent URLs — we resolve
    // tags back to canonical URLs in-process. This is the cheapest way to
    // give the demo "real" citations without web search and without ever
    // surfacing a hallucinated link.
    const allowedTags = Object.keys(CITATION_LIBRARY).join(', ');
    const allowedKinds = ALLOWED_ACTION_KINDS.join(', ');
    const sysPrompt =
      'You are a senior content strategist for AI-search visibility (GEO). ' +
      'Given a single user prompt and per-engine visibility, output a JSON object with these fields: ' +
      '{ hypothesis, recommendedTreatment, suggestedExperimentName, recommendedMinLiftPp, narrative, citationTags, actionPlan }. ' +
      'hypothesis is one sentence describing why visibility is what it is and what to change. ' +
      'recommendedTreatment is 1-2 sentences describing the concrete content change. ' +
      'suggestedExperimentName is <=80 chars, kebab-case-ish but human readable. ' +
      'recommendedMinLiftPp is an integer 3..15 representing the minimum detectable effect we should target. ' +
      'narrative is an array of 3-5 short paragraphs (each <=240 chars) walking the reader through the reasoning chain: ' +
      '(1) what the data shows, (2) the diagnosis, (3) the recommended treatment and why, (4) the expected effect. ' +
      `citationTags is an array of 3-6 tags chosen ONLY from this closed set: [${allowedTags}]. ` +
      'Pick the tags whose canonical sources most directly back the recommended treatment. ' +
      'Never invent URLs — only return tags from the list above. ' +
      'actionPlan is an array of 2-5 concrete actions a marketer can ship to lift this prompt. ' +
      'Each action is { kind, title, description, priority, effort, expectedImpact, target?, steps, examples? }. ' +
      `kind MUST be one of: [${allowedKinds}]. ` +
      'title is <=80 chars; description is 1-3 sentences (<=320 chars). ' +
      "priority is 'high'|'medium'|'low'; effort is 'small'|'medium'|'large'. " +
      "expectedImpact is a short phrase like '+5pp on Perplexity'. " +
      'target is optional — a URL or page identifier the action edits/creates. ' +
      'steps is an array of 3-6 concrete sub-tasks (<=160 chars each) the marketer can check off. ' +
      'examples is optional — 1-3 concrete content samples (FAQ Q&A, blog headline candidates, comparison-table rows, JSON-LD snippet, etc., <=240 chars each). ' +
      'Order actions from highest to lowest priority. Tailor each action to the SPECIFIC prompt and engine breakdown — do not return generic advice.';
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.OPENAI_HYPOTHESIS_MODEL ?? 'gpt-4o-mini',
          temperature: 0.4,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        this.logger.warn(`OpenAI hypothesis call ${res.status}; falling back to heuristic`);
        return null;
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = json.choices?.[0]?.message?.content;
      if (!content) return null;
      const parsed = JSON.parse(content) as {
        hypothesis?: string;
        recommendedTreatment?: string;
        suggestedExperimentName?: string;
        recommendedMinLiftPp?: number;
        narrative?: unknown;
        citationTags?: unknown;
        actionPlan?: unknown;
      };
      if (
        typeof parsed.hypothesis !== 'string' ||
        typeof parsed.recommendedTreatment !== 'string' ||
        typeof parsed.suggestedExperimentName !== 'string' ||
        typeof parsed.recommendedMinLiftPp !== 'number'
      ) {
        return null;
      }
      const narrative = sanitiseNarrative(parsed.narrative) ??
        this.buildHeuristicResearch({
          promptText: input.promptText,
          overallVisibility: input.overallVisibility,
          engineBreakdown: input.engineBreakdown,
          recommendedTreatment: parsed.recommendedTreatment,
        }).narrative;
      const citationTags = sanitiseCitationTags(parsed.citationTags);
      const citations = citationTags.length > 0
        ? citationTags.map(tagToCitation).filter((c): c is ResearchCitation => c !== null)
        : pickHeuristicCitations({
            recommendedTreatment: parsed.recommendedTreatment,
            overallVisibility: input.overallVisibility,
          });
      // Sanitise the LLM-provided actionPlan; fall back to the heuristic
      // when missing / malformed so the UI's section 3 always renders.
      const sanitisedPlan = sanitiseActionPlan(parsed.actionPlan, input.promptId);
      const actionPlan =
        sanitisedPlan && sanitisedPlan.length > 0
          ? sanitisedPlan
          : this.buildHeuristicActionPlan({
              promptId: input.promptId,
              promptText: input.promptText,
              overallVisibility: input.overallVisibility,
              engineBreakdown: input.engineBreakdown,
              recommendedTreatment: parsed.recommendedTreatment,
            });
      return {
        hypothesis: parsed.hypothesis,
        recommendedTreatment: parsed.recommendedTreatment,
        suggestedExperimentName: parsed.suggestedExperimentName.slice(0, 160),
        recommendedMinLiftPp: clamp(Math.round(parsed.recommendedMinLiftPp), 3, 15),
        weakEngines: weakEnginesOf(input.engineBreakdown),
        strongEngines: strongEnginesOf(input.engineBreakdown),
        research: { narrative, citations },
        actionPlan,
      };
    } catch (err) {
      this.logger.warn(`OpenAI hypothesis call failed (${(err as Error).message}); using heuristic`);
      return null;
    }
  }

  /**
   * Deterministic fallback for the research bundle — used when OpenAI is
   * unavailable, when the LLM returns a malformed payload, and when we
   * back-fill cache rows written before the research feature shipped.
   *
   * Composes a 4-paragraph narrative from the same numbers the hypothesis
   * uses (overall + per-engine visibility), and picks 4 citations from
   * `CITATION_LIBRARY` based on which intervention type the recommended
   * treatment maps to (FAQ / schema markup / comparison table / authority
   * / generic). The picker matches against keywords in the treatment text
   * — not perfect, but it's stable, side-effect-free, and gives the
   * "View research" modal something honest to display in the demo.
   */
  private buildHeuristicResearch(input: {
    promptText: string | null;
    overallVisibility: number | null;
    engineBreakdown: EngineRow[];
    recommendedTreatment: string;
  }): ResearchBundle {
    const overall = input.overallVisibility ?? 0;
    const overallPct = (overall * 100).toFixed(1);
    const subject = promptToSubject(input.promptText) ?? 'this prompt';
    const weak = weakEnginesOf(input.engineBreakdown);
    const strong = strongEnginesOf(input.engineBreakdown);

    const narrative: string[] = [];
    narrative.push(
      input.engineBreakdown.length > 0
        ? `Overall visibility for "${subject}" is ${overallPct}% across ${input.engineBreakdown.length} tracked engines (last 14 days).`
        : `Overall visibility for "${subject}" is ${overallPct}%; no per-engine breakdown is available yet.`,
    );
    if (weak.length > 0 || strong.length > 0) {
      const parts: string[] = [];
      if (strong.length > 0) parts.push(`strong on ${strong.join(', ')}`);
      if (weak.length > 0) parts.push(`weak on ${weak.join(', ')}`);
      narrative.push(
        `The retrieval signal is uneven — ${parts.join('; ')}. Uneven engine coverage is the strongest predictor that the page lacks the structured anchors models index for retrieval.`,
      );
    } else {
      narrative.push(
        'Without a per-engine breakdown the most actionable intervention is to publish a structurally complete answer page (TL;DR + FAQ + comparison + schema) and re-measure.',
      );
    }
    narrative.push(
      'Industry research on AI Overviews and generative search consistently finds that pages with FAQPage / Product schema, primary-source citations, and at-a-glance comparison tables out-rank prose-only competitors in LLM retrieval.',
    );
    narrative.push(
      `Applying the recommended treatment should lift visibility into the 50–70% band on the weak engines within 1–2 indexing cycles, which is why we target a minimum detectable effect of around ${overall < 0.2 ? 7 : 5}pp.`,
    );

    const citations = pickHeuristicCitations({
      recommendedTreatment: input.recommendedTreatment,
      overallVisibility: input.overallVisibility,
    });
    return { narrative, citations };
  }

  private buildLlmUserPrompt(input: {
    promptText: string | null;
    overallVisibility: number | null;
    engineBreakdown: EngineRow[];
  }): string {
    const lines: string[] = [];
    lines.push(`User prompt: ${input.promptText ?? '(text unavailable)'}`);
    lines.push(
      `Overall visibility: ${
        input.overallVisibility != null
          ? (input.overallVisibility * 100).toFixed(1) + '%'
          : 'unknown'
      }`,
    );
    lines.push('Per-engine visibility (last 14 days):');
    if (input.engineBreakdown.length === 0) {
      lines.push('  (no per-engine breakdown available)');
    } else {
      for (const r of input.engineBreakdown) {
        lines.push(`  - ${r.model_id}: ${(r.visibility * 100).toFixed(1)}%`);
      }
    }
    lines.push(
      'Return JSON only. The recommendedTreatment must be the kind of content change a marketer can ship in a PR (FAQ block, comparison table, schema markup, primary-source citations, etc).',
    );
    return lines.join('\n');
  }

  private buildHeuristic(input: {
    promptText: string | null;
    overallVisibility: number | null;
    engineBreakdown: EngineRow[];
  }): Omit<PromptHypothesisResult,
    'promptId' | 'promptText' | 'overallVisibility' | 'engineBreakdown' | 'source' | 'computedAt' | 'cached' | 'research' | 'actionPlan' | 'generations'> {
    const overall = input.overallVisibility ?? 0;
    const weak = weakEnginesOf(input.engineBreakdown);
    const strong = strongEnginesOf(input.engineBreakdown);
    const subject = promptToSubject(input.promptText) ?? 'this prompt';

    let hypothesis: string;
    let recommendedTreatment: string;
    let recommendedMinLiftPp: number;

    if (overall === 0 && input.engineBreakdown.length === 0) {
      hypothesis = `We have no visibility for "${subject}" yet — the prompt is a green-field opportunity.`;
      recommendedTreatment =
        'Publish a primary, well-structured page that directly answers this query: lead paragraph, FAQ block, and a comparison table. Include explicit author bio + sources so model retrieval has citation anchors.';
      recommendedMinLiftPp = 8;
    } else if (overall < 0.2) {
      hypothesis = `Visibility on "${subject}" is low (${(overall * 100).toFixed(1)}%). Models likely don't have a structured anchor to retrieve.`;
      recommendedTreatment =
        'Rewrite the target page with a TL;DR, FAQ block, and an at-a-glance comparison table. Add JSON-LD FAQPage / Product schema and primary-source citations to every claim.';
      recommendedMinLiftPp = 7;
    } else if (overall < 0.5) {
      hypothesis =
        weak.length > 0
          ? `"${subject}" surfaces on ${strong.join(', ') || 'some engines'} but is weak on ${weak.join(', ')}. The retrieval signal is uneven.`
          : `"${subject}" has middling visibility — there's room to compound by improving structure and primary citations.`;
      recommendedTreatment =
        'Add an FAQ block specifically targeting the weak engines\' phrasing patterns, and reinforce the page with at least three primary-source citations (vendor docs, peer-reviewed studies, or first-party data).';
      recommendedMinLiftPp = 5;
    } else {
      hypothesis = `"${subject}" is already strong (${(overall * 100).toFixed(1)}%) — use it as a control baseline rather than a treatment.`;
      recommendedTreatment =
        'Keep this prompt as a control. For treatment, pick an under-performing prompt from the bottom of the dashboard and apply the FAQ + comparison-table pattern there.';
      recommendedMinLiftPp = 4;
    }

    const suggestedExperimentName = `Boost visibility on "${truncate(subject, 60)}"`;
    return {
      hypothesis,
      recommendedTreatment,
      suggestedExperimentName,
      recommendedMinLiftPp,
      weakEngines: weak,
      strongEngines: strong,
    };
  }

  /**
   * Deterministic action-plan fallback used when OpenAI is unavailable
   * or returns a malformed plan, and to back-fill cache rows written
   * before the action-plan feature shipped.
   *
   * Strategy: classify the recommended-treatment text into intervention
   * categories (FAQ, schema, comparison, citations, content rewrite,
   * green-field publish), then emit one tailored ActionItem per matched
   * category. The plan is always non-empty; if no category matches we
   * fall back to a "publish a structurally complete answer page" action
   * so the UI never renders a stub.
   *
   * Steps and examples are templated against the actual prompt subject
   * (and weak engines, when available) so the fallback still feels
   * specific to the prompt rather than generic boilerplate.
   */
  private buildHeuristicActionPlan(input: {
    promptId: string;
    promptText: string | null;
    overallVisibility: number | null;
    engineBreakdown: EngineRow[];
    recommendedTreatment: string;
  }): ActionItem[] {
    const subject = promptToSubject(input.promptText) ?? 'this prompt';
    const overall = input.overallVisibility ?? 0;
    const weak = weakEnginesOf(input.engineBreakdown);
    const weakLabel = weak.length > 0 ? weak.join(', ') : 'the weak engines';
    const t = input.recommendedTreatment.toLowerCase();
    const lift = overall < 0.2 ? 7 : 5;
    const plan: ActionItem[] = [];
    const seen = new Set<ActionKind>();
    // Stamps a stable `id` on every action so generations stay attached
    // across re-analyzes for the same (promptId, kind, title) triple.
    const push = (item: Omit<ActionItem, 'id'>) => {
      if (seen.has(item.kind)) return;
      seen.add(item.kind);
      plan.push({ id: actionIdFor(input.promptId, item.kind, item.title), ...item });
    };

    if (/\bfaq\b/.test(t)) {
      push({
        kind: 'faq',
        title: `Add an FAQ block answering "${truncate(subject, 50)}"`,
        description: `LLM retrieval over Q&A-shaped prompts is dominated by pages that expose explicit FAQ pairs. Publish 4-6 questions phrased the way ${weakLabel} would re-state this query, with concise 2-3 sentence answers.`,
        priority: 'high',
        effort: 'small',
        expectedImpact: `+${lift}pp on ${weakLabel}`,
        steps: [
          `Brainstorm 6-8 question variants of "${truncate(subject, 50)}" by paraphrasing how each weak engine tends to ask it.`,
          'Write a 2-3 sentence answer per question; lead with the direct answer, follow with one concrete example or stat.',
          'Wrap the block in FAQPage JSON-LD so AI Overviews can lift it verbatim.',
          'Publish on the highest-traffic page that already targets this prompt; cross-link from related pages.',
        ],
        examples: [
          `Q: "What is the best ${truncate(subject, 40)}?" — A: lead-with-answer, then 2 reasons + 1 stat.`,
          `Q: "How do I evaluate ${truncate(subject, 40)}?" — A: 3-step shortlist + linked deep-dive.`,
        ],
      });
    }

    if (/schema|json-?ld|structured data/.test(t)) {
      push({
        kind: 'schema_markup',
        title: 'Ship JSON-LD structured data on the target page',
        description: `Empirical AI-search studies (Ahrefs, Princeton GEO) consistently find FAQPage / Product / Article schema among the strongest predictors of LLM citation. Add the schema type that matches this prompt's intent.`,
        priority: 'high',
        effort: 'small',
        expectedImpact: `+${Math.max(3, lift - 2)}pp on ${weakLabel}`,
        steps: [
          'Choose the schema type matching the prompt intent (FAQPage for Q&A, Product for product comparisons, Article for editorial).',
          'Generate JSON-LD with all required fields; validate with Google Rich Results Test before deploy.',
          'Embed in <head> of the target page; do not block via CSP.',
          'Re-fetch in Search Console and re-trigger Perplexity / Bing crawl.',
        ],
        examples: [
          '{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"…","acceptedAnswer":{"@type":"Answer","text":"…"}}]}',
        ],
      });
    }

    if (/comparison|table|head-to-head|vs\b/.test(t)) {
      push({
        kind: 'comparison_table',
        title: 'Add an at-a-glance comparison table',
        description: `Comparison tables are the single most-retrieved layout for "best X for Y" queries because LLMs can lift rows verbatim. Build a 4-6 row table comparing the top alternatives for "${truncate(subject, 50)}".`,
        priority: 'medium',
        effort: 'medium',
        expectedImpact: '+3-5pp on Perplexity / ChatGPT',
        steps: [
          'List the 4-6 most-mentioned alternatives in your category (use Peec\'s own brand-totals view as a shortlist).',
          'Pick 4-6 columns that map to user decision criteria (price, integrations, target user, deployment model, etc.).',
          'Fill rows with one-line, citation-backed facts; link each row to a dedicated comparison page if available.',
          'Render as a real <table> (not an image) and add a TL;DR sentence above it.',
        ],
        examples: [
          '| Tool | Pricing | Best for | Standout feature | Source |',
          '| ---- | ------- | -------- | ---------------- | ------ |',
        ],
      });
    }

    if (/citation|primary source|author bio|sources|references/.test(t)) {
      push({
        kind: 'citations',
        title: 'Reinforce the page with primary-source citations',
        description: `Generative engines weight cited claims much more heavily than uncited ones (Princeton GEO, 2024). Add at least 3 primary-source citations per major claim — vendor docs, peer-reviewed studies, or first-party data.`,
        priority: 'medium',
        effort: 'small',
        expectedImpact: `+3pp on ${weakLabel}`,
        steps: [
          'List every factual claim on the target page; tag those without a primary source.',
          'Replace secondary blog references with vendor docs / peer-reviewed studies / first-party reports.',
          'Use real <a href> links with descriptive anchor text (not "click here").',
          'Add a visible "Sources" section at the bottom of the page.',
        ],
      });
    }

    if (
      /rewrite|tl;dr|lead paragraph|publish|landing|answer page|primary, well-structured/.test(
        t,
      ) ||
      plan.length === 0
    ) {
      const isGreenfield = overall === 0;
      push({
        kind: isGreenfield ? 'new_landing_page' : 'content_update',
        title: isGreenfield
          ? `Publish a primary answer page for "${truncate(subject, 50)}"`
          : `Rewrite the target page with a TL;DR + structured anchors`,
        description: isGreenfield
          ? `There is no existing visibility for "${truncate(subject, 50)}", which means it is a green-field opportunity. Publish a single canonical answer page that owns this query end-to-end.`
          : `The target page is being retrieved unevenly across engines. Rewrite the top half with a one-paragraph TL;DR, then layer FAQ + comparison + citation anchors so each engine has something to lift.`,
        priority: isGreenfield ? 'high' : 'medium',
        effort: 'large',
        expectedImpact: `+${lift}pp overall`,
        steps: [
          isGreenfield
            ? 'Choose a canonical URL (e.g. /guides/<slug>) and reserve it.'
            : 'Identify the target URL; audit current word-count, headings, and schema.',
          'Write a 2-3 sentence TL;DR that directly answers the prompt; place above the fold.',
          'Add an FAQ block (4-6 Q&A pairs) below the lede.',
          'Add a comparison table or primary-source citations block depending on intent.',
          'Add author bio with credentials + last-updated timestamp for E-E-A-T.',
          'Wire FAQPage / Product schema and re-submit to Search Console.',
        ],
      });
    }

    // Always end with a "write a supporting blog" action — secondary
    // content reinforces the primary page's retrieval signal across
    // engines and is cheap to commission.
    push({
      kind: 'blog',
      title: `Publish a supporting blog post on "${truncate(subject, 50)}"`,
      description: `One supporting article angled at "${truncate(subject, 50)}" gives ${weakLabel} a second retrieval anchor on your domain. Internal-link it back to the target landing page and to the FAQ block above.`,
      priority: 'low',
      effort: 'medium',
      expectedImpact: '+1-2pp compounding over 2-4 weeks',
      steps: [
        `Pick a long-tail angle on "${truncate(subject, 50)}" not covered by the main page.`,
        'Aim for ~1,200 words with at least one original chart or data point.',
        'Add 2-3 internal links to the target landing page using natural-language anchors.',
        'Publish, then submit to Search Console and ping Perplexity\'s sitemap.',
      ],
      examples: [
        `Headline: "5 patterns for ${truncate(subject, 40)} (with examples)"`,
        `Headline: "How we improved ${truncate(subject, 40)} by 32% in 6 weeks"`,
      ],
    });

    // Cap to 5 — beyond that the cards become noise rather than a plan.
    return plan.slice(0, 5);
  }
}

function weakEnginesOf(rows: EngineRow[]): string[] {
  // "Weak" = visibility below 30% AND below the median across the breakdown.
  if (rows.length === 0) return [];
  const sorted = [...rows].map((r) => r.visibility).sort((a, b) => a - b);
  const median =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
      : sorted[(sorted.length - 1) / 2]!;
  return rows
    .filter((r) => r.visibility < 0.3 && r.visibility <= median)
    .map((r) => r.model_id);
}

function strongEnginesOf(rows: EngineRow[]): string[] {
  return rows.filter((r) => r.visibility >= 0.5).map((r) => r.model_id);
}

function promptToSubject(text: string | null): string | null {
  if (!text) return null;
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length === 0) return null;
  return t.length <= 90 ? t : `${t.slice(0, 87)}…`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

interface ColumnarPayload {
  columns?: string[];
  rows?: unknown[][];
}

function decodeColumnar<T extends Record<string, unknown>>(payload: unknown): T[] {
  if (!payload || typeof payload !== 'object') return [];
  const { columns, rows } = payload as ColumnarPayload;
  if (!Array.isArray(columns) || !Array.isArray(rows)) return [];
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      out[col] = row[i];
    });
    return out as T;
  });
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/**
 * Closed library of citations the research bundle is allowed to reference.
 * Every entry is a real, primary or first-tier source for one of the
 * canonical GEO interventions (schema markup, FAQ blocks, comparison
 * tables, primary-source citations, AI-search studies). The OpenAI prompt
 * is constrained to picking tags from this map — never to inventing URLs
 * — so the modal never surfaces a hallucinated link.
 *
 * The map is `Object.freeze`'d so accidental mutation can't poison the
 * library between requests; the service is a long-lived NestJS singleton.
 */
type CitationCategory =
  | 'faq'
  | 'schema'
  | 'comparison'
  | 'authority'
  | 'aiSearch'
  | 'general';

interface CitationLibraryEntry {
  title: string;
  url: string;
  domain: string;
  note: string;
  category: CitationCategory;
}

const CITATION_LIBRARY: Readonly<Record<string, CitationLibraryEntry>> = Object.freeze({
  faqPageSchema: {
    title: 'FAQPage schema specification',
    url: 'https://schema.org/FAQPage',
    domain: 'schema.org',
    note: 'Authoritative spec for FAQPage structured data — the highest-leverage anchor for LLM retrieval on Q&A-shaped prompts.',
    category: 'faq',
  },
  productSchema: {
    title: 'Product schema specification',
    url: 'https://schema.org/Product',
    domain: 'schema.org',
    note: 'Spec for Product structured data — used by AI engines to surface product-shaped answers with explicit fields.',
    category: 'schema',
  },
  googleStructuredData: {
    title: 'Google Search — Introduction to structured data markup',
    url: 'https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data',
    domain: 'developers.google.com',
    note: 'Google\'s primary guidance on JSON-LD markup; the reference implementation that AI Overviews indexes against.',
    category: 'schema',
  },
  googleFaqGuide: {
    title: 'Google Search — FAQ structured data guidance',
    url: 'https://developers.google.com/search/docs/appearance/structured-data/faqpage',
    domain: 'developers.google.com',
    note: 'Implementation rules for FAQ markup, including the question/answer-pair patterns AI engines retrieve verbatim.',
    category: 'faq',
  },
  ahrefsAiOverviews: {
    title: 'Ahrefs — How AI Overviews change SEO (2024 study, 2.7M queries)',
    url: 'https://ahrefs.com/blog/ai-overviews/',
    domain: 'ahrefs.com',
    note: 'Empirical study on which page features correlate with citation in Google AI Overviews — schema and structured Q&A win.',
    category: 'aiSearch',
  },
  searchEngineLandComparison: {
    title: 'Search Engine Land — Comparison content patterns that rank',
    url: 'https://searchengineland.com/best-comparison-content-best-rank-441693',
    domain: 'searchengineland.com',
    note: 'Editorial review of comparison-table layouts that consistently win head-to-head queries in AI search.',
    category: 'comparison',
  },
  semrushGeo: {
    title: 'Semrush — Generative Engine Optimization (GEO) playbook',
    url: 'https://www.semrush.com/blog/generative-engine-optimization/',
    domain: 'semrush.com',
    note: 'Industry-standard playbook for optimizing pages for ChatGPT, Perplexity, and Google AI search.',
    category: 'aiSearch',
  },
  princetonGeoStudy: {
    title: 'GEO: Generative Engine Optimization (Princeton et al., 2024)',
    url: 'https://arxiv.org/abs/2311.09735',
    domain: 'arxiv.org',
    note: 'Peer-reviewed study quantifying which content interventions (citations, statistics, quotations) lift visibility in generative engines.',
    category: 'aiSearch',
  },
  googleEEAT: {
    title: 'Google — E-E-A-T and Quality Rater Guidelines',
    url: 'https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
    domain: 'developers.google.com',
    note: 'Google\'s guidance on demonstrating expertise, experience, authoritativeness, and trust — the ranking signal that primary-source citations directly target.',
    category: 'authority',
  },
  niemanLabCitations: {
    title: 'Nieman Lab — Why primary-source citations matter for AI retrieval',
    url: 'https://www.niemanlab.org/2024/05/the-citation-economy-of-ai-search/',
    domain: 'niemanlab.org',
    note: 'Analysis of how generative engines weight primary-source citations when synthesising answers.',
    category: 'authority',
  },
  perplexityCitationDocs: {
    title: 'Perplexity — How sources are selected and cited',
    url: 'https://www.perplexity.ai/hub/blog/how-perplexity-works',
    domain: 'perplexity.ai',
    note: 'First-party explanation of Perplexity\'s retrieval pipeline — confirms that structured, well-cited pages are preferred sources.',
    category: 'aiSearch',
  },
});

function tagToCitation(tag: string): ResearchCitation | null {
  const entry = CITATION_LIBRARY[tag];
  if (!entry) return null;
  return {
    tag,
    title: entry.title,
    url: entry.url,
    domain: entry.domain,
    note: entry.note,
  };
}

/**
 * Picks 4 citations for the heuristic / fallback research path.
 *
 * Logic: classify the recommended treatment text into one or more
 * categories (FAQ, schema, comparison, authority, AI-search), then pick
 * the strongest source per matched category, padding with `aiSearch`
 * generalists so we always return a non-empty list. The classification
 * is intentionally simple-string-match; we don't need NLP, just a stable
 * mapping the demo can reason about.
 */
function pickHeuristicCitations(input: {
  recommendedTreatment: string;
  overallVisibility: number | null;
}): ResearchCitation[] {
  const t = input.recommendedTreatment.toLowerCase();
  const matches: CitationCategory[] = [];
  if (/\bfaq\b/.test(t)) matches.push('faq');
  if (/schema|json-?ld|structured data/.test(t)) matches.push('schema');
  if (/comparison|table|head-to-head|vs\b/.test(t)) matches.push('comparison');
  if (/citation|primary source|author bio|sources|references/.test(t)) {
    matches.push('authority');
  }
  // Always include at least one AI-search generalist so the modal has
  // context for *why* these interventions matter.
  matches.push('aiSearch');

  // Stable order: matched categories first (in detection order), then
  // de-duplicated entries. The Set tracks tags, not categories, because
  // some categories share an entry.
  const picked: ResearchCitation[] = [];
  const seen = new Set<string>();
  const pickFromCategory = (cat: CitationCategory) => {
    for (const [tag, entry] of Object.entries(CITATION_LIBRARY)) {
      if (entry.category !== cat) continue;
      if (seen.has(tag)) continue;
      seen.add(tag);
      picked.push({ tag, title: entry.title, url: entry.url, domain: entry.domain, note: entry.note });
      return;
    }
  };
  for (const cat of matches) pickFromCategory(cat);
  // Pad to 4 with general entries from any unused category.
  for (const [tag, entry] of Object.entries(CITATION_LIBRARY)) {
    if (picked.length >= 4) break;
    if (seen.has(tag)) continue;
    seen.add(tag);
    picked.push({ tag, title: entry.title, url: entry.url, domain: entry.domain, note: entry.note });
  }
  return picked.slice(0, 4);
}

function sanitiseNarrative(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const cleaned = input
    .filter((p): p is string => typeof p === 'string')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => (p.length <= 320 ? p : `${p.slice(0, 317)}…`));
  if (cleaned.length === 0) return null;
  return cleaned.slice(0, 6);
}

function sanitiseCitationTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of input) {
    if (typeof tag !== 'string') continue;
    if (!CITATION_LIBRARY[tag]) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * Coerces a stored `format` string into the `ActionGeneration.format`
 * union. Defaults to `markdown` for unknown values rather than
 * propagating an invalid literal up to TypeScript-strict callers.
 */
export function normaliseFormat(input: string): 'markdown' | 'json' | 'text' {
  if (input === 'json' || input === 'text') return input;
  return 'markdown';
}

function isResearchBundle(value: unknown): value is ResearchBundle {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  if (!Array.isArray(r.narrative)) return false;
  if (!Array.isArray(r.citations)) return false;
  return r.citations.every((c) => {
    if (!c || typeof c !== 'object') return false;
    const o = c as Record<string, unknown>;
    return (
      typeof o.tag === 'string' &&
      typeof o.title === 'string' &&
      typeof o.url === 'string' &&
      typeof o.domain === 'string' &&
      typeof o.note === 'string'
    );
  });
}

/**
 * Closed list of action kinds the LLM is allowed to emit. Kept in sync
 * with the `ActionKind` union; the runtime `Set` is what the sanitiser
 * checks against. Adding a new kind here is a one-line change but also
 * requires the web component to render an icon / heading for it — see
 * `KIND_META` in apps/web/components/experiment-implementer.tsx.
 */
export const ALLOWED_ACTION_KINDS: readonly ActionKind[] = [
  'faq',
  'blog',
  'content_update',
  'schema_markup',
  'comparison_table',
  'citations',
  'new_landing_page',
  'internal_linking',
  'author_bio',
  'other',
] as const;

/**
 * Computes the deterministic id for an ActionItem. Used as the storage
 * key in `ActionGenerationCache` and as the `actionId` the
 * `/v1/peec/actions/generate` endpoint expects.
 *
 * Format: `${promptId}:${kind}:${slug}` where slug is the lowercased,
 * dash-joined first 60 chars of the title. Truncated to a 200-char hard
 * cap so we never blow up the unique index on long titles. Kept stable
 * across re-analyzes — as long as the (promptId, kind, title) triple
 * doesn't change, generations stay attached.
 *
 * Exported so the `ActionGeneratorService` can recompute the same id
 * server-side when validating the request body, and so tests can assert
 * the contract directly.
 */
export function actionIdFor(
  promptId: string,
  kind: string,
  title: string,
): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';
  const id = `${promptId}:${kind}:${slug}`;
  return id.length <= 200 ? id : id.slice(0, 200);
}

const ALLOWED_ACTION_KINDS_SET = new Set<ActionKind>(ALLOWED_ACTION_KINDS);
const ALLOWED_PRIORITY_SET = new Set<ActionPriority>(['high', 'medium', 'low']);
const ALLOWED_EFFORT_SET = new Set<ActionEffort>(['small', 'medium', 'large']);

/**
 * Validates and normalises an LLM-supplied actionPlan, stamping a
 * deterministic `id` on every entry via `actionIdFor(promptId, …)`. We
 * deliberately overwrite any id the LLM tries to invent — the server
 * controls the contract so the UI can rely on `id` being stable across
 * re-analyzes for unchanged kind+title pairs.
 *
 * Returns null when the input is not an array; returns an empty array
 * when every entry was rejected (callers treat both the same way and
 * fall back to the heuristic). Keeps the sanitiser strict so a malformed
 * entry cannot brick the UI rendering downstream.
 *
 * Also de-duplicates by `id` — if the LLM repeats a near-identical
 * (kind, title) pair the second one is dropped, otherwise we'd violate
 * the unique constraint on `ActionGenerationCache`.
 */
function sanitiseActionPlan(
  input: unknown,
  promptId: string,
): ActionItem[] | null {
  if (!Array.isArray(input)) return null;
  const out: ActionItem[] = [];
  const seenIds = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.kind !== 'string' || !ALLOWED_ACTION_KINDS_SET.has(r.kind as ActionKind)) {
      continue;
    }
    if (typeof r.title !== 'string' || r.title.length === 0) continue;
    if (typeof r.description !== 'string' || r.description.length === 0) continue;
    if (typeof r.priority !== 'string' || !ALLOWED_PRIORITY_SET.has(r.priority as ActionPriority)) {
      continue;
    }
    if (typeof r.effort !== 'string' || !ALLOWED_EFFORT_SET.has(r.effort as ActionEffort)) {
      continue;
    }
    if (typeof r.expectedImpact !== 'string' || r.expectedImpact.length === 0) continue;
    if (!Array.isArray(r.steps)) continue;
    const steps = r.steps
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => (s.length <= 200 ? s : `${s.slice(0, 197)}…`))
      .slice(0, 8);
    if (steps.length === 0) continue;
    const examples =
      Array.isArray(r.examples)
        ? r.examples
            .filter((e): e is string => typeof e === 'string')
            .map((e) => e.trim())
            .filter((e) => e.length > 0)
            .map((e) => (e.length <= 320 ? e : `${e.slice(0, 317)}…`))
            .slice(0, 4)
        : undefined;
    const target =
      typeof r.target === 'string' && r.target.trim().length > 0
        ? r.target.trim().slice(0, 200)
        : undefined;
    const title = r.title.length <= 120 ? r.title : `${r.title.slice(0, 117)}…`;
    const id = actionIdFor(promptId, r.kind, title);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    out.push({
      id,
      kind: r.kind as ActionKind,
      title,
      description: r.description.length <= 360 ? r.description : `${r.description.slice(0, 357)}…`,
      priority: r.priority as ActionPriority,
      effort: r.effort as ActionEffort,
      expectedImpact:
        r.expectedImpact.length <= 100
          ? r.expectedImpact
          : `${r.expectedImpact.slice(0, 97)}…`,
      target,
      steps,
      examples: examples && examples.length > 0 ? examples : undefined,
    });
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * Cache-row backfill guard. Kept conservative — we only treat a stored
 * value as a valid action plan when every entry shape-checks AND has a
 * non-empty `id`. Older cache rows written before the `id` field shipped
 * fail this check and fall through to the heuristic backfill, which
 * (re-)stamps ids server-side.
 */
function isActionPlan(value: unknown): value is ActionItem[] {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return false;
  return value.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const o = item as Record<string, unknown>;
    return (
      typeof o.id === 'string' &&
      o.id.length > 0 &&
      typeof o.kind === 'string' &&
      ALLOWED_ACTION_KINDS_SET.has(o.kind as ActionKind) &&
      typeof o.title === 'string' &&
      typeof o.description === 'string' &&
      typeof o.priority === 'string' &&
      ALLOWED_PRIORITY_SET.has(o.priority as ActionPriority) &&
      typeof o.effort === 'string' &&
      ALLOWED_EFFORT_SET.has(o.effort as ActionEffort) &&
      typeof o.expectedImpact === 'string' &&
      Array.isArray(o.steps) &&
      o.steps.every((s) => typeof s === 'string')
    );
  });
}
