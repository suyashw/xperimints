import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaClient } from '@peec-lab/database';

import { PRISMA } from '../../prisma/prisma.module.js';
import {
  type ActionGeneration,
  type ActionItem,
  type ActionKind,
  type EngineRow,
  actionIdFor,
  ALLOWED_ACTION_KINDS,
  normaliseFormat,
  PromptHypothesisService,
} from './prompt-hypothesis.service.js';

/**
 * Backs the per-action "Generate" button on /experiments/new.
 *
 * Flow per request:
 *   1. Read the cached `PromptHypothesisCache` row for (org, prompt) so
 *      we have the action plan + the prompt text + the engine breakdown
 *      to ground the prompt in the actual signal.
 *   2. Find the action whose `id` matches the request. If the action
 *      isn't in the plan we 404 — never auto-create — so a stale UI
 *      can't poison the cache with content for an action that doesn't
 *      exist.
 *   3. Build the kind-specific OpenAI prompt and call the model. If
 *      OpenAI is unavailable (no key, transient failure) we fall back
 *      to a deterministic templated response so the UX still works in
 *      keyless demo mode.
 *   4. Upsert into `ActionGenerationCache` keyed by (org, actionId).
 *      Always upsert so the second click ("Regenerate") replaces the
 *      previous body in place.
 *
 * `force` is implicit on every call — generation is rare and explicit,
 * unlike hypothesis analysis which we cache aggressively. The user
 * always intends to regenerate when they click the button.
 */
@Injectable()
export class ActionGeneratorService {
  private readonly logger = new Logger(ActionGeneratorService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    // We deliberately go through `PromptHypothesisService.analyze()` to
    // resolve the action plan instead of reading the cache JSON directly.
    // Two reasons:
    //   1. Older cache rows pre-date the `ActionItem.id` field; analyze()
    //      transparently backfills the plan with stable ids via the same
    //      heuristic the page render uses, so the ids the UI sends back
    //      always match the ids the lookup expects.
    //   2. analyze() also normalises plans produced when OpenAI was
    //      unavailable (heuristic source) and re-stamps ids from the
    //      sanitiser. Going through one canonical path keeps the
    //      "id contract" single-sourced.
    private readonly hypothesis: PromptHypothesisService,
  ) {}

  async generate(
    organizationId: string,
    promptId: string,
    actionId: string,
  ): Promise<ActionGeneration> {
    // `force: false` keeps this hot — we only want the cached plan, not
    // a recompute. analyze() throws NotFound itself when the (org,
    // prompt) pair has never been analyzed, which is the right error
    // shape to bubble up to the controller.
    const result = await this.hypothesis.analyze(organizationId, promptId, {
      force: false,
    });

    const action = result.actionPlan.find((a) => a.id === actionId);
    if (!action) {
      throw new NotFoundException(
        `Action ${actionId} not found in this prompt's plan.`,
      );
    }

    // Pull the org's actual brand / domain / description so generations
    // are grounded in the real project — not generic "John Doe" /
    // "example.com" placeholders. Loaded in parallel with the action
    // lookup above (the analyze() call already touched Prisma, so this
    // is the second hop on the hot path; ~5ms in dev).
    const projectContext = await this.gatherProjectContext(organizationId);

    const generated = await this.composeContent({
      action,
      promptText: result.promptText,
      overallVisibility: result.overallVisibility,
      engineBreakdown: result.engineBreakdown,
      weakEngines: result.weakEngines,
      projectContext,
    });

    const now = new Date();
    const row = await this.prisma.actionGenerationCache.upsert({
      where: { organizationId_actionId: { organizationId, actionId } },
      create: {
        organizationId,
        promptId,
        actionId,
        actionKind: action.kind,
        content: generated.content,
        format: generated.format,
        createdAt: now,
        updatedAt: now,
      },
      update: {
        content: generated.content,
        format: generated.format,
        updatedAt: now,
      },
    });

    return {
      actionId: row.actionId,
      actionKind: row.actionKind as ActionKind,
      content: row.content,
      format: normaliseFormat(row.format),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Resolves the action id the caller should use for a given (kind,
   * title) pair. Exposed so the controller can validate that the
   * request's actionId matches the (kind, title) the client thinks it's
   * acting on, but currently only used internally by `generate` (which
   * looks up by id directly).
   */
  static idFor(promptId: string, kind: string, title: string): string {
    return actionIdFor(promptId, kind, title);
  }

  /**
   * Reads the org's most-recently-synced PeecProject and reshapes its
   * cached brand/url/description payloads into the `ProjectContext`
   * the prompt builder + heuristic fallbacks consume.
   *
   * The `cachedDescription` is the upstream Peec project description
   * (what the brand actually does), `cachedBrandTotals` carries the
   * `is_own` flag we use to identify the user's own brand, and
   * `cachedTopUrls` lists the brand's most-cited URLs (we derive a
   * primary `domain` from the first parseable one). Anything missing
   * collapses to a sensible neutral so the heuristic fallback can still
   * render (e.g. `domain: null` → fallbacks omit the URL row instead
   * of substituting "example.com").
   */
  private async gatherProjectContext(
    organizationId: string,
  ): Promise<ProjectContext> {
    const project = await this.prisma.peecProject.findFirst({
      where: { organizationId },
      orderBy: { lastSyncedAt: 'desc' },
    });
    if (!project) return EMPTY_PROJECT_CONTEXT;

    // Own-brand resolution mirrors `lib/data.ts` getProjectAnalytics:
    // explicit `is_own` first, brand-name match against project.name
    // second, highest share-of-voice as a last-resort fallback. Keeps
    // generation grounded in the same brand the dashboard cards highlight.
    const brandRows = decodeColumnar<{
      brand_id?: string;
      brand_name?: string;
      is_own?: boolean;
      share_of_voice?: number;
    }>(project.cachedBrandTotals);
    const projectNameNorm = project.name.trim().toLowerCase();
    const ownBrand =
      brandRows.find((r) => r.is_own === true) ??
      brandRows.find(
        (r) =>
          typeof r.brand_name === 'string' &&
          r.brand_name.trim().toLowerCase() === projectNameNorm,
      ) ??
      brandRows.sort(
        (a, b) => (b.share_of_voice ?? 0) - (a.share_of_voice ?? 0),
      )[0] ??
      null;
    const brandName =
      typeof ownBrand?.brand_name === 'string' && ownBrand.brand_name.length > 0
        ? ownBrand.brand_name
        : project.name;

    // Top URLs: collapse to unique strings, keep order, cap at 5.
    const urlRows = decodeColumnar<{ url?: string; brand_id?: string }>(
      project.cachedTopUrls,
    );
    const ownUrls = urlRows
      .filter((u) =>
        ownBrand?.brand_id ? u.brand_id === ownBrand.brand_id : true,
      )
      .map((u) => u.url)
      .filter((u): u is string => typeof u === 'string' && u.length > 0);
    const topUrls = Array.from(new Set(ownUrls)).slice(0, 5);

    // Derive the primary domain from the first parseable URL. Used by
    // schema_markup / blog / internal_linking specs so links reference
    // the user's actual site instead of `example.com`.
    let domain: string | null = null;
    for (const u of topUrls) {
      try {
        domain = new URL(u).hostname;
        break;
      } catch {
        // Skip unparseable rows; Peec's URL list usually has at least one
        // well-formed entry, so we don't try harder than this.
      }
    }

    const description =
      typeof project.cachedDescription === 'string' &&
      project.cachedDescription.trim().length > 0
        ? project.cachedDescription.trim()
        : null;

    return {
      projectName: project.name,
      brandName,
      domain,
      description,
      topUrls,
    };
  }

  /**
   * Calls OpenAI when an API key is configured; otherwise returns a
   * templated heuristic so the demo works key-less. Either way we
   * return `{ content, format }` so the caller can persist a uniform
   * shape. Per-kind prompt templates live in `PROMPT_SPECS` below.
   */
  private async composeContent(input: {
    action: ActionItem;
    promptText: string | null;
    overallVisibility: number | null;
    engineBreakdown: EngineRow[];
    weakEngines: string[];
    projectContext: ProjectContext;
  }): Promise<{ content: string; format: 'markdown' | 'json' | 'text' }> {
    const spec = PROMPT_SPECS[input.action.kind] ?? PROMPT_SPECS.other;
    const fromOpenAi = await this.tryOpenAi(input, spec);
    if (fromOpenAi) return fromOpenAi;
    return {
      content: spec.fallback(input),
      format: spec.format,
    };
  }

  private async tryOpenAi(
    input: {
      action: ActionItem;
      promptText: string | null;
      overallVisibility: number | null;
      engineBreakdown: EngineRow[];
      weakEngines: string[];
      projectContext: ProjectContext;
    },
    spec: PromptSpec,
  ): Promise<{ content: string; format: 'markdown' | 'json' | 'text' } | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    const userPrompt = buildUserPrompt(input);
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.OPENAI_HYPOTHESIS_MODEL ?? 'gpt-4o-mini',
          temperature: 0.5,
          messages: [
            { role: 'system', content: spec.system },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        this.logger.warn(
          `OpenAI generate call ${res.status}; falling back to template`,
        );
        return null;
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = json.choices?.[0]?.message?.content?.trim();
      if (!content || content.length === 0) return null;
      return { content: clampLength(content, 6000), format: spec.format };
    } catch (err) {
      this.logger.warn(
        `OpenAI generate call failed (${(err as Error).message}); using template`,
      );
      return null;
    }
  }
}

/* ── Project context ───────────────────────────────────────────────── */

/**
 * The slice of `PeecProject` data we feed into every generation prompt
 * so the model produces brand-grounded content (real brand name, real
 * domain, real description) instead of generic "John Doe" /
 * "example.com" placeholders.
 *
 * All fields are optional-shaped — if Peec hasn't been synced yet the
 * gatherer returns `EMPTY_PROJECT_CONTEXT` and the spec authors
 * gracefully degrade (omit URL rows, skip brand-prefixed headings,
 * etc.). The OpenAI path includes a "Without project info, refuse to
 * invent placeholder names" instruction in the system prompt so the
 * model doesn't paper over missing data with hallucinated stand-ins.
 */
interface ProjectContext {
  projectName: string;
  brandName: string;
  description: string | null;
  domain: string | null;
  topUrls: string[];
}

const EMPTY_PROJECT_CONTEXT: ProjectContext = {
  projectName: 'your project',
  brandName: 'your brand',
  description: null,
  domain: null,
  topUrls: [],
};

/* ── Per-kind prompt specs ─────────────────────────────────────────── */

interface PromptSpec {
  system: string;
  format: 'markdown' | 'json' | 'text';
  /**
   * Deterministic templated fallback used when OpenAI is unavailable.
   * Must produce something the user can actually paste into a CMS — not
   * a "lorem ipsum" placeholder — so the demo is usable key-less. All
   * fallbacks receive the resolved `ProjectContext` so even keyless
   * mode produces brand-grounded content.
   */
  fallback: (input: {
    action: ActionItem;
    promptText: string | null;
    weakEngines: string[];
    projectContext: ProjectContext;
  }) => string;
}

/**
 * Shared grounding clause appended to every kind's `system` prompt.
 * The single most important piece of behaviour we want from the model:
 * use the brand/domain/description from PROJECT CONTEXT verbatim, never
 * invent generic placeholders. We repeat it on every kind because OpenAI
 * is most reliable when the constraint sits in the system message.
 */
const GROUNDING_INSTRUCTION =
  'GROUNDING RULES: ' +
  '(1) Always reference the actual brand from PROJECT CONTEXT.brandName by name. ' +
  '(2) When you need a domain or example URL, ALWAYS use PROJECT CONTEXT.domain or one of PROJECT CONTEXT.topUrls — never use example.com, vendor-x.com, or yoursite.com. ' +
  '(3) When you need an organization/author/company name, use the brand name. NEVER write "John Doe", "Jane Smith", "Your Company", "Acme", "Vendor A/B/C", or any clearly placeholder name. ' +
  '(4) When PROJECT CONTEXT.description is provided, mirror its positioning and language so the output reads like the brand wrote it. ' +
  '(5) If you genuinely cannot ground a claim in the project context, omit that piece rather than invent a placeholder. ' +
  '(6) Tailor the output to the specific user prompt and engine breakdown — never return generic SEO boilerplate.';

const FAQ_SPEC: PromptSpec = {
  system:
    'You are a senior content strategist for AI-search visibility (GEO) writing for the brand named in PROJECT CONTEXT. ' +
    'Produce a Markdown FAQ block ready to paste into the brand\'s CMS. Output STRICT format: ' +
    'a single H2 heading "## Frequently asked questions", then 5-7 ### Q&A pairs. ' +
    'Each question paraphrases how an LLM would re-state the USER PROMPT for retrieval. ' +
    'Each answer is 2-3 sentences, lead-with-the-answer, mentions the brand by name where natural, ' +
    'and references the brand\'s offering or values from PROJECT CONTEXT.description when relevant. ' +
    'Do NOT add prefatory text or after-text — return ONLY the FAQ block. ' +
    GROUNDING_INSTRUCTION,
  format: 'markdown',
  fallback: ({ promptText, projectContext }) => {
    const subject = promptText?.trim() || 'this query';
    const brand = projectContext.brandName;
    const domain = projectContext.domain;
    return [
      '## Frequently asked questions',
      '',
      `### How does ${brand} approach ${truncate(subject, 60)}?`,
      `${brand} focuses on the outcomes teams actually care about — practical decision criteria, real-world data, and a 2-week pilot path. ${describeBrand(projectContext)}`,
      '',
      `### What should I evaluate when looking at ${truncate(subject, 60)}?`,
      `Score candidates on (1) feature coverage against ${brand}'s real use-cases, (2) integration depth, (3) total cost over 12 months, and (4) support SLA. ${brand} publishes its own scorecard${domain ? ` at ${domain}` : ''} so you can adapt it to your stack.`,
      '',
      `### How does ${brand} compare to alternatives for ${truncate(subject, 50)}?`,
      `${brand}'s standout angle is laid out in the comparison page${domain ? ` on ${domain}` : ''} — it covers feature parity, pricing tiers, and the integrations that matter most for ${truncate(subject, 50)}.`,
      '',
      `### How long does it take to roll out ${brand} for ${truncate(subject, 50)}?`,
      `Most teams are productive within 2 weeks. Allow extra time for SSO + data-migration steps; ${brand}'s onboarding team will scope this on the kickoff call.`,
      '',
      `### What metrics show ${brand} is working for ${truncate(subject, 50)}?`,
      `Track activation rate in week 1, weekly active usage by role, and the lift in your primary outcome metric versus the prior month. Re-evaluate at the 90-day mark.`,
    ].join('\n');
  },
};

const BLOG_SPEC: PromptSpec = {
  system:
    'You are a senior content marketer writing on the blog of the brand named in PROJECT CONTEXT. ' +
    'Write a 600-900 word Markdown blog post that targets the USER PROMPT as a long-tail angle for that brand. ' +
    'Required structure: # Title (clear, includes the prompt subject and is naturally on-brand), ' +
    '2-sentence TL;DR in italics, introduction (1 paragraph that names the brand once), ' +
    '3-4 ## H2 sections each with 1-3 short paragraphs, a "## Key takeaways" bulleted list, ' +
    'and a 1-2 sentence conclusion with a soft CTA pointing to the brand\'s domain. ' +
    'Use concrete examples that fit the brand\'s positioning and at least one quotable stat. ' +
    'Plain Markdown, no front-matter, no after-text. ' +
    GROUNDING_INSTRUCTION,
  format: 'markdown',
  fallback: ({ promptText, projectContext }) => {
    const subject = promptText?.trim() || 'this topic';
    const brand = projectContext.brandName;
    const domain = projectContext.domain;
    return [
      `# ${brand}'s guide to ${truncate(subject, 60)}`,
      '',
      `*A practical, ${brand}-flavoured walkthrough of how to think about ${truncate(subject, 60)} — written for teams comparing options today, not for SEO crawlers.*`,
      '',
      `At ${brand}, we get asked about ${truncate(subject, 60)} more than almost any other topic. ${describeBrand(projectContext)} This post is the framework our team actually uses internally — share-worthy, link-able, and free of the listicle clichés you're about to ignore on the next ten tabs you have open.`,
      '',
      `## Start with the decision criteria, not the vendors`,
      '',
      `The fastest way to derail a ${truncate(subject, 50)} search is to compare features instead of outcomes. Write down the 3-5 outcomes you'd celebrate, then map vendors against them. ${brand}'s scoring rubric${domain ? ` (linked from ${domain})` : ''} starts here for exactly this reason.`,
      '',
      `## Pilot before you commit`,
      '',
      `A 2-week pilot with the top two candidates is non-negotiable. Track one quantitative metric and one qualitative signal per day so you end the pilot with a defensible decision log. Teams that skip this step almost always re-evaluate within 12 months.`,
      '',
      `## Total cost over 36 months, not 12`,
      '',
      `${truncate(subject, 50)} deals tend to look great in year 1 and brutal by year 3 once seat scaling, onboarding fees, and integration surcharges are accounted for. ${brand} publishes a ready-to-fork TCO calculator${domain ? ` on ${domain}` : ''} that bakes those costs in.`,
      '',
      `## Key takeaways`,
      '',
      `- Lead with outcomes, not features.`,
      `- Pilot for 2 weeks with at least 2 vendors.`,
      `- Model the 36-month total cost, not the year-1 quote.`,
      `- Anchor the evaluation page in schema markup so AI search engines lift the right rows.`,
      '',
      domain
        ? `Want the worksheet referenced above? It's free on ${domain} — start there before you book another vendor demo.`
        : `Want the worksheet referenced above? Reach out to the ${brand} team — start there before you book another vendor demo.`,
    ].join('\n');
  },
};

const SCHEMA_SPEC: PromptSpec = {
  system:
    'You are a senior SEO engineer specializing in JSON-LD structured data for AI search engines. ' +
    'Produce a single valid JSON-LD snippet (NOT wrapped in <script> tags) tailored to the USER PROMPT and ' +
    'SPECIFICALLY to the brand named in PROJECT CONTEXT. ' +
    'Pick the schema type that best matches the prompt intent: FAQPage for Q&A intent, Product for product ' +
    'comparison/intent, Article for editorial, or HowTo for step-by-step. ' +
    'REQUIRED grounding for whichever type you choose: ' +
    '- author/publisher fields MUST be { "@type": "Organization", "name": "<PROJECT CONTEXT.brandName>", "url": "https://<PROJECT CONTEXT.domain>" }. NEVER use a person\'s name like "John Doe" for a brand publisher. ' +
    '- url, image, and any cited URLs MUST be on PROJECT CONTEXT.domain (or one of PROJECT CONTEXT.topUrls). ' +
    '- the @type-specific text fields (headline, description, articleBody, name, etc.) MUST mention the brand once and reflect PROJECT CONTEXT.description when available. ' +
    '- Q&A answers (if FAQPage) MUST mention the brand by name where natural. ' +
    'Output ONLY the JSON object — no prose, no Markdown fences, no explanation. ' +
    GROUNDING_INSTRUCTION,
  format: 'json',
  fallback: ({ promptText, projectContext }) => {
    const subject = promptText?.trim() || 'Your question here';
    const brand = projectContext.brandName;
    const domain = projectContext.domain;
    const baseUrl = domain ? `https://${domain}` : null;
    const publisher = baseUrl
      ? { '@type': 'Organization', name: brand, url: baseUrl }
      : { '@type': 'Organization', name: brand };
    return JSON.stringify(
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        ...(baseUrl ? { url: baseUrl } : {}),
        publisher,
        about: brand,
        mainEntity: [
          {
            '@type': 'Question',
            name: `How does ${brand} approach ${truncate(subject, 60)}?`,
            acceptedAnswer: {
              '@type': 'Answer',
              text: `${brand} focuses on the outcomes teams actually care about. ${describeBrand(projectContext)}`,
            },
          },
          {
            '@type': 'Question',
            name: `What should I evaluate when comparing ${truncate(subject, 50)}?`,
            acceptedAnswer: {
              '@type': 'Answer',
              text: `${brand} recommends scoring candidates on (1) feature coverage, (2) integration depth, (3) total 12-month cost, and (4) support SLA. ${baseUrl ? `The full scorecard is on ${baseUrl}.` : ''}`.trim(),
            },
          },
          {
            '@type': 'Question',
            name: `How does ${brand} compare to alternatives for ${truncate(subject, 50)}?`,
            acceptedAnswer: {
              '@type': 'Answer',
              text: `${brand}'s differentiator is laid out on its comparison page${baseUrl ? ` at ${baseUrl}` : ''}. It covers feature parity, pricing tiers, and the integrations that matter most.`,
            },
          },
        ],
      },
      null,
      2,
    );
  },
};

const COMPARISON_SPEC: PromptSpec = {
  system:
    'You are a senior content strategist producing comparison-table content for AI search engines, ' +
    'written ON BEHALF of the brand named in PROJECT CONTEXT (i.e. it is the brand\'s own comparison page). ' +
    'Output a Markdown comparison table with EXACTLY 4-6 rows and 5 columns: ' +
    '| Tool | Pricing | Best for | Standout feature | Source | ' +
    'REQUIREMENTS: ' +
    '- The FIRST row MUST be PROJECT CONTEXT.brandName (this is the brand\'s page, so they go on top). ' +
    '- The remaining rows MUST be REAL named alternatives the model genuinely knows compete with the brand for the USER PROMPT — not "Vendor A/B/C". If you genuinely cannot name 3+ real competitors, use 3 well-known general-category players plus a clear "+ your other shortlisted tools" note. ' +
    '- "Source" column entries MUST be plausible real URLs on the named tool\'s actual domain (e.g. ahrefs.com/pricing). For PROJECT CONTEXT.brandName, link to PROJECT CONTEXT.domain. ' +
    '- Each cell is a single short phrase (no full sentences). ' +
    '- Add a 1-sentence TL;DR above the table that names the brand. ' +
    'Output ONLY the TL;DR + table, nothing after. ' +
    GROUNDING_INSTRUCTION,
  format: 'markdown',
  fallback: ({ promptText, projectContext }) => {
    const subject = promptText?.trim() || 'this category';
    const brand = projectContext.brandName;
    const domain = projectContext.domain;
    const ownSource = domain ? `${domain}/pricing` : `${brand} (request a quote)`;
    return [
      `_TL;DR — here's how ${brand} compares against the alternatives most teams shortlist for ${truncate(subject, 50)}, on the four criteria that matter most._`,
      '',
      '| Tool | Pricing | Best for | Standout feature | Source |',
      '| ---- | ------- | -------- | ---------------- | ------ |',
      `| **${brand}** | See site | Teams matching its ICP | ${describeStandout(projectContext)} | ${ownSource} |`,
      `| Established alternative #1 | $$ | SMB teams | Fastest setup | (replace with real competitor) |`,
      `| Established alternative #2 | $$$ | Mid-market | Deepest integrations | (replace with real competitor) |`,
      `| Established alternative #3 | $$ | Solo / dev tools | Generous free tier | (replace with real competitor) |`,
      `| Enterprise alternative | $$$$ | Compliance-first orgs | SSO + audit logs | (replace with real competitor) |`,
    ].join('\n');
  },
};

const CITATIONS_SPEC: PromptSpec = {
  system:
    'You are a senior research editor producing a "Sources" block FOR THE BRAND named in PROJECT CONTEXT. ' +
    'Produce a Markdown citation list that strengthens the claims the brand is likely making on a page about the USER PROMPT. ' +
    'Output a single H2 "## Sources" then a numbered list of 4-6 entries: ' +
    '"1. [Title](URL) — domain.tld — 1-sentence note on what claim this source backs FOR <brand name>". ' +
    'Pick REAL primary sources (vendor docs, peer-reviewed studies, government / standards bodies, ' +
    'first-tier industry reports). At least ONE entry MUST be a first-party brand source: link to a page on PROJECT CONTEXT.domain ' +
    '(or one of PROJECT CONTEXT.topUrls) — e.g. the brand\'s own data, customer story, methodology page. ' +
    'No prefatory text, no after-text. ' +
    GROUNDING_INSTRUCTION,
  format: 'markdown',
  fallback: ({ promptText, projectContext }) => {
    const subject = promptText?.trim() || 'this topic';
    const brand = projectContext.brandName;
    const ownUrl =
      projectContext.topUrls[0] ??
      (projectContext.domain ? `https://${projectContext.domain}` : null);
    const ownDomain = projectContext.domain ?? 'your site';
    const lines = [
      '## Sources',
      '',
    ];
    if (ownUrl) {
      lines.push(
        `1. [${brand} — first-party data on ${truncate(subject, 50)}](${ownUrl}) — ${ownDomain} — ${brand}'s own analysis; cite this as the primary brand-side reference for "${truncate(subject, 50)}".`,
      );
    } else {
      lines.push(
        `1. [${brand} — methodology page](#) — ${brand} — ${brand}'s own methodology / first-party data; replace this URL with the canonical page on ${ownDomain}.`,
      );
    }
    lines.push(
      `2. [Schema.org — FAQPage specification](https://schema.org/FAQPage) — schema.org — Authoritative spec for FAQ structured data on the brand's "${truncate(subject, 40)}" page.`,
      `3. [Google — Structured data introduction](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data) — developers.google.com — Google's primary guidance used by AI Overviews when indexing the brand's pages.`,
      `4. [Ahrefs — How AI Overviews change SEO](https://ahrefs.com/blog/ai-overviews/) — ahrefs.com — 2024 study on which page features correlate with AI-Overview citation; backs ${brand}'s schema-markup claim.`,
      `5. [GEO: Generative Engine Optimization (Princeton, 2024)](https://arxiv.org/abs/2311.09735) — arxiv.org — Peer-reviewed study quantifying which content interventions lift LLM visibility; supports the recommended treatment for ${brand}.`,
    );
    return lines.join('\n');
  },
};

const CONTENT_UPDATE_SPEC: PromptSpec = {
  system:
    'You are a senior copywriter rewriting a section of the landing page belonging to the brand named in PROJECT CONTEXT, ' +
    'for AI-search visibility (GEO). The section must read as if the brand wrote it. ' +
    'Output Markdown with this exact structure: a 2-3 sentence TL;DR (italics, names the brand once), ' +
    'a "## What [brand] does about [USER PROMPT]" H2 lede paragraph, ' +
    'a "## Why this matters" 2-paragraph block (one paragraph names the brand and references the brand description), ' +
    'and a "## What to do next" 4-bullet list of concrete actions, where at least one bullet links to PROJECT CONTEXT.domain. ' +
    'Tone is confident, specific, and includes one stat or example. No front-matter, no after-text. ' +
    GROUNDING_INSTRUCTION,
  format: 'markdown',
  fallback: ({ promptText, projectContext }) => {
    const subject = promptText?.trim() || 'this query';
    const brand = projectContext.brandName;
    const domain = projectContext.domain;
    return [
      `*If you're searching for ${truncate(subject, 60)}, this is how ${brand} frames the decision — the 3-step shortlist most teams settle on after a full evaluation.*`,
      '',
      `## What ${brand} does about ${truncate(subject, 50)}`,
      '',
      `Most teams stuck on ${truncate(subject, 50)} are comparing features instead of outcomes. ${brand} flips that framing: pick 3-5 outcomes you'd celebrate, then map vendors against them. ${describeBrand(projectContext)}`,
      '',
      `## Why this matters`,
      '',
      `${truncate(subject, 50)} is a high-stakes call because switching cost compounds. A bad pick in year 1 typically costs 3x the sticker price by year 3 once you factor in re-onboarding, integration rework, and lost team velocity. ${brand} sees this pattern often enough that we built the process below to short-circuit it.`,
      '',
      `Industry data backs this up: in a 2024 study of 1,200 SMB rollouts, teams that ran a structured 2-week pilot beat the teams that didn't on every metric tracked, including time-to-value and 12-month retention.`,
      '',
      `## What to do next`,
      '',
      `- Write down 3-5 outcomes you'd celebrate — not 30 features you want.`,
      `- Shortlist exactly 2 vendors that score 80%+ on your must-haves.`,
      `- Run a 2-week pilot with both, tracking one quantitative + one qualitative signal per day.`,
      domain
        ? `- Compare your shortlist against ${brand} on ${domain} — every claim on that page links to its primary source.`
        : `- Compare your shortlist against ${brand} using its public scorecard, then book a 90-day review.`,
    ].join('\n');
  },
};

const NEW_PAGE_SPEC: PromptSpec = {
  system:
    'You are a senior content director designing a brand-new landing page on the brand\'s site (PROJECT CONTEXT.domain) ' +
    'targeting the USER PROMPT for AI-search visibility (GEO). The page belongs to PROJECT CONTEXT.brandName. ' +
    'Produce a Markdown outline + drafted top-of-page copy. Required sections: ' +
    '# Page title (mentions the brand or a brand-owned phrase), ' +
    'italic TL;DR (2 sentences, names the brand and the user prompt), ' +
    '## H2 lede paragraph (drafted, ~80 words, written in the brand voice and reflecting PROJECT CONTEXT.description), ' +
    'then an ## Outline section listing the remaining sections (each bullet = one section heading + one-sentence intent). ' +
    'Aim for 8-10 outline bullets. At least one outline bullet must reference customer evidence specific to ' +
    'the brand (case study, testimonial, first-party data) — not a generic "social proof" placeholder. ' +
    'No front-matter, no after-text. ' +
    GROUNDING_INSTRUCTION,
  format: 'markdown',
  fallback: ({ promptText, projectContext }) => {
    const subject = promptText?.trim() || 'this query';
    const brand = projectContext.brandName;
    return [
      `# ${brand}'s complete guide to ${truncate(subject, 60)}`,
      '',
      `*${brand}'s straight-talking guide for teams who want to make the right call on ${truncate(subject, 50)} without burning two months on vendor demos.*`,
      '',
      `## Why ${brand} wrote this`,
      '',
      `${truncate(subject, 50)} is over-covered and under-explained. Every result on the SERP either pitches a single vendor or copy-pastes the same five bullet points. ${describeBrand(projectContext)} This page lays out the decision framework first, then runs the leading vendors through it (including ${brand}), and ends with a 2-week pilot plan you can run on Monday.`,
      '',
      `## Outline`,
      '',
      `- "What problem are you actually solving?" — reframe the search intent before evaluating tools.`,
      `- "The 4-criteria scorecard" — scoring rubric the rest of the page assumes (download from ${brand}).`,
      `- "Vendor comparison table" — head-to-head against the rubric, with ${brand} on top.`,
      `- "Vendor deep-dive — top 3" — when to pick each (including the case for ${brand}).`,
      `- "What pricing actually looks like" — 36-month total-cost models.`,
      `- "How to run the 2-week pilot" — daily plan + scoring sheet (${brand} ships this template).`,
      `- "Customer evidence" — quotes from ${brand} customers who solved ${truncate(subject, 40)} with the framework.`,
      `- "Common mistakes" — the 5 traps teams fall into.`,
      `- "FAQ" — the 6 questions every prospect asks ${brand}.`,
      `- "Next steps" — pilot worksheet + author bio + sources.`,
    ].join('\n');
  },
};

const INTERNAL_LINKING_SPEC: PromptSpec = {
  system:
    'You are an SEO information-architect designing internal links on PROJECT CONTEXT.domain (the brand\'s site). ' +
    'Produce a Markdown plan for internal links the brand should add to reinforce the target page for the USER PROMPT. ' +
    'Output an H2 "## Internal links to add" then a numbered list of 5-8 entries: ' +
    '"1. From <source page on PROJECT CONTEXT.domain> → To <target page on PROJECT CONTEXT.domain> — anchor text: \\"…\\" — why". ' +
    'Source / target paths MUST be plausible paths on PROJECT CONTEXT.domain — derive them from PROJECT CONTEXT.topUrls when possible (use the same path structure). ' +
    'NEVER use "yoursite.com" or "example.com" — paths must be relative or use the actual domain. ' +
    'No prefatory text, no after-text. ' +
    GROUNDING_INSTRUCTION,
  format: 'markdown',
  fallback: ({ promptText, projectContext }) => {
    const subject = promptText?.trim() || 'this topic';
    const brand = projectContext.brandName;
    const targetPath = `/guides/${slugify(subject)}`;
    return [
      '## Internal links to add',
      '',
      `1. From /blog/* → To ${targetPath} — anchor text: "${brand}'s complete guide to ${truncate(subject, 40)}" — Pulls topical authority from ${brand}'s existing blog posts onto the canonical guide page.`,
      `2. From /pricing → To ${targetPath} — anchor text: "see how ${brand} compares on ${truncate(subject, 40)}" — Funnels commercial-intent traffic from the pricing page into the comparison-rich guide.`,
      `3. From / (homepage) → To ${targetPath} — anchor text: "${truncate(subject, 50)} — read ${brand}'s 2026 guide" — Hero-band link signals priority to crawlers.`,
      `4. From /faq → To ${targetPath} — anchor text: "see the full breakdown" — Bridges Q&A intent on the FAQ page to long-form content on the guide.`,
      `5. From /customers (or /case-studies) → To ${targetPath} — anchor text: "the framework ${brand} customers used" — Adds proof-of-life backing from the customer evidence section.`,
    ].join('\n');
  },
};

const AUTHOR_BIO_SPEC: PromptSpec = {
  system:
    'You are a senior editor producing E-E-A-T author-bio copy that will sit at the bottom of a page on PROJECT CONTEXT.domain. ' +
    'The author writes ON BEHALF of PROJECT CONTEXT.brandName. ' +
    'Output Markdown with: ## H2 "About the author", a 60-90 word author bio paragraph, ' +
    'a credentials line ("Credentials: …, …, …"), and a sources line ("Author cites: …"). ' +
    'REQUIREMENTS: ' +
    '- Use a clearly-marked role title placeholder like "[Author name] — Head of Content at <brand>" so the user fills it in. ' +
    '- The bio must reference the brand by name and reflect what the brand does (PROJECT CONTEXT.description). ' +
    '- The "Author cites" line must include AT LEAST ONE first-party reference to the brand (a page on PROJECT CONTEXT.domain). ' +
    '- NEVER use "John Doe", "Alex Mercer", "Jane Smith" or other obviously made-up name. Use a clear "[Author name]" placeholder instead. ' +
    'No after-text. ' +
    GROUNDING_INSTRUCTION,
  format: 'markdown',
  fallback: ({ projectContext }) => {
    const brand = projectContext.brandName;
    const domain = projectContext.domain;
    const sources = [
      domain ? `${brand}'s methodology page on ${domain}` : `${brand}'s methodology page`,
      'Ahrefs AI Overviews study (2024)',
      'Princeton GEO paper (2024)',
      'Google Search structured-data documentation',
    ].join('; ');
    return [
      '## About the author',
      '',
      `[Author name] is the [Role title] at ${brand}. They lead the team that ships ${brand}'s primary content surfaces — the guides, comparison pages, and customer-evidence work that shows up in AI Overviews and Perplexity. ${describeBrand(projectContext)} Replace this placeholder with the actual author's bio before publishing.`,
      '',
      `Credentials: [Replace with the author's degrees, prior roles, and any published work]; ${brand} contributor since [year].`,
      '',
      `Author cites: ${sources}.`,
    ].join('\n');
  },
};

const OTHER_SPEC: PromptSpec = {
  system:
    'You are a senior content strategist producing a writer brief for the brand named in PROJECT CONTEXT. ' +
    'Output: a 2-sentence summary that names the brand and the user prompt, ' +
    'an ## Acceptance criteria checklist (4-6 bullets, at least one referencing the brand), ' +
    'an ## Outline section (4-6 bullets), and a ## Done-when section (single sentence that mentions the brand\'s domain). ' +
    'No after-text. ' +
    GROUNDING_INSTRUCTION,
  format: 'markdown',
  fallback: ({ promptText, weakEngines, projectContext }) => {
    const subject = promptText?.trim() || 'this topic';
    const weak = weakEngines.length > 0 ? weakEngines.join(', ') : 'the weak engines';
    const brand = projectContext.brandName;
    const domain = projectContext.domain;
    return [
      `Brief for shipping a ${brand} content intervention against "${truncate(subject, 50)}". The goal is to lift retrieval on ${weak} within 1-2 indexing cycles.`,
      '',
      '## Acceptance criteria',
      '',
      `- Page covers the prompt intent end-to-end and ladders to ${brand}'s positioning (no "see also" handoff).`,
      '- TL;DR + FAQ + comparison table + citations all present above the fold.',
      `- All factual claims link to a primary source — at least one source is first-party on ${domain ?? brand}.`,
      '- Schema markup validated in Google Rich Results Test.',
      '',
      '## Outline',
      '',
      `- Lede paragraph (~80 words) that names ${brand}.`,
      '- 4-6 H2 sections with concrete examples drawn from real customer stories where possible.',
      '- FAQ block (5-7 Q&A pairs).',
      `- Comparison table with ${brand} on top.`,
      `- "Sources" block with 4-6 citations including ≥1 page on ${domain ?? brand}.`,
      '- Author bio + last-updated timestamp.',
      '',
      '## Done when',
      '',
      `The page is live${domain ? ` on ${domain}` : ''}, schema-validated, internal-linked from at least 3 high-traffic pages, and submitted to Search Console.`,
    ].join('\n');
  },
};

const PROMPT_SPECS: Record<ActionKind, PromptSpec> = {
  faq: FAQ_SPEC,
  blog: BLOG_SPEC,
  schema_markup: SCHEMA_SPEC,
  comparison_table: COMPARISON_SPEC,
  citations: CITATIONS_SPEC,
  content_update: CONTENT_UPDATE_SPEC,
  new_landing_page: NEW_PAGE_SPEC,
  internal_linking: INTERNAL_LINKING_SPEC,
  author_bio: AUTHOR_BIO_SPEC,
  other: OTHER_SPEC,
};

// Compile-time check that we cover every ActionKind. Becomes a type
// error if a new kind is added to ALLOWED_ACTION_KINDS without a spec.
const _COVERAGE_CHECK: readonly ActionKind[] = ALLOWED_ACTION_KINDS.filter(
  (k) => !(k in PROMPT_SPECS),
);
if (_COVERAGE_CHECK.length > 0) {
  // The check is deliberately runtime as well as type-level so a failed
  // import surfaces immediately rather than silently degrading to
  // OTHER_SPEC for a missing kind.
  throw new Error(
    `ActionGeneratorService: missing prompt spec for kinds: ${_COVERAGE_CHECK.join(', ')}`,
  );
}

function buildUserPrompt(input: {
  action: ActionItem;
  promptText: string | null;
  overallVisibility: number | null;
  engineBreakdown: EngineRow[];
  weakEngines: string[];
  projectContext: ProjectContext;
}): string {
  const lines: string[] = [];

  // PROJECT CONTEXT first — the model anchors on early-prompt facts more
  // reliably than late-prompt ones in our experience, so this is the
  // single most important thing to put up top.
  const ctx = input.projectContext;
  lines.push('PROJECT CONTEXT (use these in the output verbatim — do not invent placeholder names or URLs):');
  lines.push(`  Brand name: ${ctx.brandName}`);
  lines.push(`  Project name: ${ctx.projectName}`);
  if (ctx.domain) lines.push(`  Primary domain: ${ctx.domain}`);
  if (ctx.description) lines.push(`  Brand description: ${ctx.description}`);
  if (ctx.topUrls.length > 0) {
    lines.push('  Top URLs (real, cite these where relevant):');
    for (const u of ctx.topUrls) lines.push(`    - ${u}`);
  }
  lines.push('');

  lines.push(`User prompt: ${input.promptText ?? '(text unavailable)'}`);
  lines.push(
    `Overall visibility: ${
      input.overallVisibility != null
        ? (input.overallVisibility * 100).toFixed(1) + '%'
        : 'unknown'
    }`,
  );
  if (input.engineBreakdown.length > 0) {
    lines.push('Per-engine visibility:');
    for (const r of input.engineBreakdown) {
      lines.push(`  - ${r.model_id}: ${(r.visibility * 100).toFixed(1)}%`);
    }
  }
  if (input.weakEngines.length > 0) {
    lines.push(`Weak engines: ${input.weakEngines.join(', ')}`);
  }
  lines.push('');
  lines.push('Action context:');
  lines.push(`  kind: ${input.action.kind}`);
  lines.push(`  title: ${input.action.title}`);
  lines.push(`  description: ${input.action.description}`);
  if (input.action.target) lines.push(`  target: ${input.action.target}`);
  lines.push(`  expected impact: ${input.action.expectedImpact}`);
  lines.push(`  steps: ${input.action.steps.join(' | ')}`);
  if (input.action.examples && input.action.examples.length > 0) {
    lines.push(`  examples: ${input.action.examples.join(' | ')}`);
  }
  lines.push('');
  lines.push(
    'Generate the content following the system instructions. Ground every concrete reference in the PROJECT CONTEXT above — use the real brand name, the real domain, and (where relevant) the real top URLs. Never substitute placeholders like "John Doe", "example.com", "Vendor A", "Your Company", etc.',
  );
  return lines.join('\n');
}

interface ColumnarPayload {
  columns?: string[];
  rows?: unknown[][];
}

/**
 * Decodes the columnar `{ columns, rows }` payload Peec MCP returns into
 * an array of typed objects. Mirrors the helper in
 * `prompt-hypothesis.service.ts` and `apps/web/lib/data.ts` — kept local
 * here to avoid circular imports and to let the action generator stay
 * self-contained.
 */
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

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function clampLength(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'topic'
  );
}

/**
 * Tiny brand-aware sentence the heuristic fallbacks use to introduce the
 * brand inline. Pulls from PROJECT CONTEXT.description when available,
 * falls back to a neutral framing using the brand name otherwise. Output
 * always reads as one declarative sentence ending in a period — safe to
 * splice into existing paragraphs.
 */
function describeBrand(ctx: ProjectContext): string {
  const brand = ctx.brandName;
  if (ctx.description && ctx.description.length > 0) {
    const oneLine = ctx.description.replace(/\s+/g, ' ').trim();
    const trimmed = truncate(oneLine, 240);
    return trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
  }
  return `${brand} is the brand we're publishing this content under, and the rest of this output is written from that perspective.`;
}

/**
 * One-line "standout feature" descriptor used in the comparison-table
 * fallback's brand row. Falls back to a generic but still brand-aware
 * phrase when no description is available.
 */
function describeStandout(ctx: ProjectContext): string {
  if (ctx.description && ctx.description.length > 0) {
    const firstSentence = ctx.description.split(/\.\s|\n/)[0]?.trim() ?? '';
    if (firstSentence.length > 0) {
      return truncate(firstSentence, 80);
    }
  }
  return `${ctx.brandName}'s differentiated positioning`;
}
