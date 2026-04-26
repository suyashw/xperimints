import { prisma } from '@peec-lab/database';
import { getSessionUser } from './auth';

/**
 * Server-only data fetchers. We query Prisma directly from React Server
 * Components — both apps share `@peec-lab/database`, so we don't need an
 * extra HTTP hop just to read.
 *
 * For mutations we round-trip through the NestJS API so all state changes
 * pass through the state machine and emit ExperimentEvents.
 */

/**
 * Resolve the organization the *currently signed-in user* belongs to.
 *
 * Each account owns exactly one org (created during signup), so this is
 * effectively `session.user → membership[0].organization`. Returns
 * `null` when no session is present (callers should treat this the
 * same as "auth required" and rely on the `(app)` layout's auth gate
 * to redirect to /login before we ever render).
 *
 * The legacy single-tenant `getDemoOrg()` helper is gone — there is no
 * shared "acme" org any more, no seed script, no bootstrap fallback.
 */
export async function getCurrentOrg() {
  const user = await getSessionUser();
  const membership = user?.memberships[0];
  return membership?.organization ?? null;
}

/**
 * Returns the most-recently-synced Peec project for the org, if any. The
 * dashboard uses this to render live counts (prompts / brands / models /
 * topics / tags) pulled straight from the connected Peec account.
 */
export async function getSyncedPeecProject(orgId: string) {
  return prisma.peecProject.findFirst({
    where: { organizationId: orgId },
    orderBy: { lastSyncedAt: 'desc' },
  });
}

interface ColumnarPayload {
  columns?: string[];
  rows?: unknown[][];
}

// Each row type extends the columnar Record<string, unknown> contract that
// `decodeColumnar()` returns — the typed fields are just the columns we
// actually consume.
interface BrandTotalRow extends Record<string, unknown> {
  brand_id?: string;
  brand_name?: string;
  visibility?: number;
  share_of_voice?: number;
  sentiment?: number;
  position?: number;
  is_own?: boolean;
}

interface PromptVisibilityRow extends Record<string, unknown> {
  prompt_id?: string;
  brand_id?: string;
  visibility?: number;
}

interface EngineVisibilityRow extends Record<string, unknown> {
  model_id?: string;
  brand_id?: string;
  visibility?: number;
  share_of_voice?: number;
}

interface UrlRow extends Record<string, unknown> {
  url?: string;
  citation_rate?: number;
  retrieval_rate?: number;
  classification?: string;
}

interface TopicRow extends Record<string, unknown> {
  id?: string;
  name?: string;
}

interface SearchQueryRow extends Record<string, unknown> {
  query?: string;
  text?: string;
  search_query?: string;
  // Different Peec workspaces expose the volume signal under
  // different column names — we reduce them to a single `volume` at
  // read time so the card doesn't have to care.
  volume?: number;
  count?: number;
  fan_out_count?: number;
  share?: number;
}

/**
 * Peec's `list_prompts` (per the OpenAPI spec) returns each prompt as
 * `{ id, messages: [{ content }], tags, topic, user_location, volume }` —
 * the human prompt text lives in `messages[0].content`, not a `text`
 * column. We keep the looser column aliases (`text` / `prompt` / `content`)
 * because some workspaces / older Peec MCP builds flatten `messages` into a
 * single string column.
 */
interface PromptMessage {
  content?: unknown;
}
interface PromptRow extends Record<string, unknown> {
  id?: string;
  text?: string;
  prompt?: string;
  content?: string;
  messages?: PromptMessage[] | string;
}

function extractPromptText(row: PromptRow): string | undefined {
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
  return undefined;
}

export interface SuggestedAction {
  title: string;
  description?: string;
  priority?: 'high' | 'medium' | 'low';
  url?: string;
}

export interface ProjectAnalytics {
  brandTotals: BrandTotalRow[];
  ownBrand: BrandTotalRow | null;
  promptVisibility: Array<{ prompt_id: string; visibility: number }>;
  engineVisibility: Array<{ model_id: string; visibility: number; share_of_voice?: number }>;
  topUrls: UrlRow[];
  topics: TopicRow[];
  tags: TopicRow[];
  promptTextById: Record<string, string>;
  actions: SuggestedAction[];
  searchQueries: Array<{ query: string; volume: number | null }>;
}

/**
 * Reshape the cached columnar payloads on PeecProject into the typed slices
 * the dashboard cards consume. Pure transformation — no DB / network calls
 * beyond the single project read, so it's safe to call on every render.
 *
 * Each slice falls back to an empty array if the corresponding sync call
 * failed (the syncer tolerates per-call failures).
 */
export async function getProjectAnalytics(orgId: string): Promise<ProjectAnalytics | null> {
  const project = await getSyncedPeecProject(orgId);
  if (!project) return null;

  // promptTextById: map prompt_id → human prompt text from list_prompts
  // (cached on PeecProject). The dashboard's "Prompt visibility" card uses
  // this so users see the actual question, not opaque pr_… cuids. See
  // `extractPromptText()` for the column-shape fallbacks we tolerate
  // (Peec's documented `messages[0].content` plus a few flatter aliases).
  const promptRows = decodeColumnar<PromptRow>(project.cachedPrompts);
  const promptTextById: Record<string, string> = {};
  for (const r of promptRows) {
    if (typeof r.id !== 'string') continue;
    const text = extractPromptText(r);
    if (text) promptTextById[r.id] = text;
  }

  const brandTotalsRows = decodeColumnar<BrandTotalRow>(project.cachedBrandTotals);
  // Own-brand resolution. Peec's get_brand_report does not currently include
  // an `is_own` flag, so we anchor on the project name → brand name match
  // (the Peec project is named after the brand it tracks, e.g. "Peec AI").
  // Order of preference:
  //   1. Explicit `is_own === true` (future-proofs against Peec adding it).
  //   2. Case-insensitive brand_name === project.name (the common case).
  //   3. Highest share_of_voice as a last-resort fallback so the card still
  //      highlights *something* on projects whose name doesn't match a brand.
  const projectNameNormalized = project.name.trim().toLowerCase();
  const ownBrand =
    brandTotalsRows.find((r) => r.is_own === true) ??
    brandTotalsRows.find(
      (r) => typeof r.brand_name === 'string'
        && r.brand_name.trim().toLowerCase() === projectNameNormalized,
    ) ??
    brandTotalsRows.sort(
      (a, b) => (b.share_of_voice ?? 0) - (a.share_of_voice ?? 0),
    )[0] ??
    null;
  const ownBrandId = ownBrand?.brand_id;

  const promptVisRaw = decodeColumnar<PromptVisibilityRow>(project.cachedPromptVisibility);
  const promptVisibility = promptVisRaw
    .filter((r) =>
      ownBrandId ? r.brand_id === ownBrandId || r.brand_id === undefined : true,
    )
    .filter((r): r is { prompt_id: string; visibility: number } & PromptVisibilityRow =>
      typeof r.prompt_id === 'string' && typeof r.visibility === 'number',
    )
    .map((r) => ({ prompt_id: r.prompt_id, visibility: r.visibility }));

  const engineVisRaw = decodeColumnar<EngineVisibilityRow>(project.cachedEngineVisibility);
  const engineVisibility = engineVisRaw
    .filter((r) =>
      ownBrandId ? r.brand_id === ownBrandId || r.brand_id === undefined : true,
    )
    .filter((r): r is { model_id: string; visibility: number } & EngineVisibilityRow =>
      typeof r.model_id === 'string' && typeof r.visibility === 'number',
    )
    .map((r) => ({
      model_id: r.model_id,
      visibility: r.visibility,
      share_of_voice: r.share_of_voice,
    }));

  // Suggested actions are stored as a plain array (not columnar). Coerce to
  // SuggestedAction[] defensively — a Peec workspace that doesn't expose
  // get_actions yet will simply yield [] and the dashboard hides the card.
  // Prisma's `JsonValue` element type is too strict to narrow with a type
  // predicate, so we cast to `unknown[]` first and re-narrow with `is`.
  const rawActions: unknown[] = Array.isArray(project.cachedActions)
    ? (project.cachedActions as unknown[])
    : [];
  const actions: SuggestedAction[] = rawActions
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .map((a) => ({
      title: typeof a.title === 'string' ? a.title : '',
      description: typeof a.description === 'string' ? a.description : undefined,
      priority:
        a.priority === 'high' || a.priority === 'medium' || a.priority === 'low'
          ? (a.priority as 'high' | 'medium' | 'low')
          : undefined,
      url: typeof a.url === 'string' ? a.url : undefined,
    }))
    .filter((a) => a.title.length > 0);

  // list_search_queries → top fan-out queries asked of AI engines.
  // The "Demand signal" card only needs the query string + a volume
  // metric, so we normalise both here and let the card render top-N.
  const searchQueryRows = decodeColumnar<SearchQueryRow>(project.cachedSearchQueries);
  const searchQueries = searchQueryRows
    .map((r) => {
      const query =
        (typeof r.query === 'string' && r.query) ||
        (typeof r.text === 'string' && r.text) ||
        (typeof r.search_query === 'string' && r.search_query) ||
        '';
      const volume =
        (typeof r.volume === 'number' && r.volume) ||
        (typeof r.count === 'number' && r.count) ||
        (typeof r.fan_out_count === 'number' && r.fan_out_count) ||
        null;
      return { query, volume };
    })
    .filter((r): r is { query: string; volume: number | null } => r.query.length > 0)
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));

  return {
    brandTotals: brandTotalsRows,
    ownBrand,
    promptVisibility,
    engineVisibility,
    topUrls: decodeColumnar<UrlRow>(project.cachedTopUrls),
    topics: decodeColumnar<TopicRow>(project.cachedTopics),
    tags: decodeColumnar<TopicRow>(project.cachedTags),
    promptTextById,
    actions,
    searchQueries,
  };
}

/**
 * Local mirror of decodeRows() from @peec-lab/mcp-clients — kept here so the
 * web app doesn't need to depend on the MCP client package just to reshape
 * already-cached JSON.
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

export async function listExperimentsForOrg(orgId: string) {
  return prisma.experiment.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: 'desc' },
    include: { result: true },
  });
}

export async function getExperimentDetail(orgId: string, id: string) {
  return prisma.experiment.findFirst({
    where: { id, organizationId: orgId },
    include: {
      result: true,
      snapshots: { orderBy: { capturedAt: 'asc' } },
      events: { orderBy: { createdAt: 'asc' } },
      peecProject: true,
    },
  });
}

export async function getExperimentByShareSlug(slug: string) {
  return prisma.experiment.findFirst({
    where: { shareSlug: slug, isPublic: true },
    include: { result: true, peecProject: true },
  });
}

export async function getDashboardSummary(orgId: string) {
  const [active, completed, all] = await Promise.all([
    prisma.experiment.count({ where: { organizationId: orgId, status: 'RUNNING' } }),
    prisma.experiment.count({ where: { organizationId: orgId, status: 'WIN' } }),
    prisma.experiment.findMany({
      where: { organizationId: orgId, status: 'WIN' },
      select: { result: { select: { liftByEngine: true } } },
    }),
  ]);
  let cumulativePp = 0;
  for (const exp of all) {
    const lifts = (exp.result?.liftByEngine ?? {}) as Record<
      string,
      { lift_pp?: number; p_value_corrected?: number }
    >;
    for (const v of Object.values(lifts)) {
      if ((v.p_value_corrected ?? 1) < 0.05 && (v.lift_pp ?? 0) > 0) {
        cumulativePp += v.lift_pp ?? 0;
      }
    }
  }
  return { activeCount: active, winCount: completed, cumulativePp };
}

/**
 * Build a YTD cumulative-pp time series for the dashboard chart. Each point
 * is "as of this date, the sum of significant +lift_pp values across all WIN
 * experiments whose result was computed by then".
 *
 * Anchor dates are the `computedAt` of each result, sorted ascending; we add
 * a leading point at year-start for visual context.
 */
export async function getCumulativeLiftSeries(
  orgId: string,
): Promise<Array<{ t: string; pp: number; label?: string }>> {
  const results = await prisma.experimentResult.findMany({
    where: {
      experiment: { organizationId: orgId },
      verdict: 'WIN',
    },
    orderBy: { computedAt: 'asc' },
    select: {
      computedAt: true,
      liftByEngine: true,
      experiment: { select: { name: true, shareSlug: true } },
    },
  });
  const start = new Date(new Date().getFullYear(), 0, 1);
  const series: Array<{ t: string; pp: number; label?: string }> = [
    { t: start.toISOString().slice(0, 10), pp: 0 },
  ];
  let acc = 0;
  for (const r of results) {
    const lifts = (r.liftByEngine ?? {}) as Record<
      string,
      { lift_pp?: number; p_value_corrected?: number }
    >;
    let bestPositive = 0;
    for (const v of Object.values(lifts)) {
      if ((v.p_value_corrected ?? 1) < 0.05 && (v.lift_pp ?? 0) > 0) {
        bestPositive = Math.max(bestPositive, v.lift_pp ?? 0);
      }
    }
    acc += bestPositive;
    series.push({
      t: r.computedAt.toISOString().slice(0, 10),
      pp: acc,
      label: r.experiment.name,
    });
  }
  return series;
}

