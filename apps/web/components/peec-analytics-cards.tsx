import type { ProjectAnalytics, SuggestedAction } from '@/lib/data';
import { EmptyState } from '@/components/empty-state';
import { ClickablePromptList } from '@/components/prompt-inspector';

/**
 * Dashboard analytics cards. Each card is a self-contained section that maps
 * one Peec MCP signal to one decision the user makes when designing an
 * experiment:
 *
 *   - BrandShareOfVoiceCard → "where do I stand vs competitors today?"
 *     (the baseline a treatment must beat)
 *   - PromptVisibilityCard  → "which prompts under-perform for my brand?"
 *     (those are the candidate treatment_prompts; top performers are
 *     candidate control_prompts)
 *   - EngineCoverageCard    → "which model_ids are worth targeting?"
 *     (lives in ./engine-coverage-card.tsx — client component because of
 *     the 'show more zero-coverage engines' toggle)
 *   - TopUrlsCard           → "which of my URLs already get cited?"
 *     (informs treatment_url choice — improving an already-cited URL has
 *     compounding value)
 *   - SuggestedActionsCard  → "what would Peec recommend I fix first?"
 *     (Peec's get_actions output, the most direct on-ramp to a new
 *     experiment — replaced the previous Topics/Tags pills which didn't
 *     drive any decision on their own)
 *
 * All values come from the cached Peec payloads on PeecProject — no
 * Peec MCP calls happen at render time.
 */
export function BrandShareOfVoiceCard({
  brandTotals,
  ownBrand,
}: {
  brandTotals: ProjectAnalytics['brandTotals'];
  ownBrand: ProjectAnalytics['ownBrand'];
}) {
  const ranked = [...brandTotals]
    .filter((b) => typeof b.share_of_voice === 'number' || typeof b.visibility === 'number')
    .sort((a, b) => (b.share_of_voice ?? b.visibility ?? 0) - (a.share_of_voice ?? a.visibility ?? 0))
    .slice(0, 6);
  const max = Math.max(...ranked.map((b) => b.share_of_voice ?? b.visibility ?? 0), 0.0001);

  return (
    <Card title="Brand share of voice" hint="Last 14 days · own brand highlighted">
      {ranked.length === 0 ? (
        <EmptyState
          title="No brand data yet"
          description="Add competitor brands in Peec or wait for the next sync."
        />
      ) : (
        <ul className="space-y-2">
          {ranked.map((b) => {
            const value = b.share_of_voice ?? b.visibility ?? 0;
            const isOwn = ownBrand?.brand_id && b.brand_id === ownBrand.brand_id;
            return (
              <li key={b.brand_id} className="space-y-1">
                <div className="flex items-baseline justify-between text-sm">
                  <span className={isOwn ? 'font-medium' : ''}>
                    {b.brand_name ?? 'Unnamed brand'}
                    {isOwn && (
                      <span className="ml-1.5 text-[10px] uppercase tracking-wider text-[color:var(--color-accent)]">
                        you
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums text-[color:var(--color-muted)]">
                    {(value * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-[color:var(--color-border)]/40 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      isOwn ? 'bg-[color:var(--color-accent)]' : 'bg-[color:var(--color-muted)]/50'
                    }`}
                    style={{ width: `${(value / max) * 100}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function PromptVisibilityCard({
  promptVisibility,
  promptTextById,
}: {
  promptVisibility: ProjectAnalytics['promptVisibility'];
  promptTextById: ProjectAnalytics['promptTextById'];
}) {
  // Union of every prompt the project knows about:
  //   - keys of promptTextById  (full `list_prompts` snapshot — even if Peec
  //     hasn't yet computed visibility for them, e.g. brand-new prompts)
  //   - prompt_ids in promptVisibility  (rows from `get_brand_report` with
  //     the prompt_id dimension; rare orphans we still don't want to drop)
  // Each row gets the visibility from the report, defaulting to 0 when
  // the prompt isn't in the report yet — so the card honestly reflects
  // everything the user has authored in Peec, not just the ones with
  // non-zero data.
  const visibilityById = new Map<string, number>();
  for (const r of promptVisibility) {
    visibilityById.set(r.prompt_id, r.visibility);
  }
  const allIds = new Set<string>([
    ...Object.keys(promptTextById),
    ...promptVisibility.map((r) => r.prompt_id),
  ]);
  const rows = Array.from(allIds)
    .map((prompt_id) => ({
      prompt_id,
      visibility: visibilityById.get(prompt_id) ?? 0,
    }))
    .sort((a, b) => b.visibility - a.visibility);

  // Rank-based accent colour. Top quartile reads as a control candidate
  // (green); bottom quartile reads as a treatment candidate (amber);
  // everything else stays neutral so the eye lands on the extremes.
  const total = rows.length;
  const topCutoff = Math.max(1, Math.ceil(total * 0.25));
  const bottomCutoff = Math.max(1, Math.ceil(total * 0.25));

  return (
    <Card
      id="prompt-visibility"
      title="Prompt visibility"
      hint={
        rows.length > 0
          ? `${rows.length} prompts · click any to inspect engines and run a hypothesis`
          : 'Click any prompt to inspect engines and run a hypothesis'
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          title="No prompts yet"
          description="Peec hasn't returned any prompts for this project. Add prompts in Peec or wait for the next sync."
        />
      ) : (
        <>
          <div className="max-h-[28rem] overflow-y-auto rounded-md">
            <RankedPromptList
              rows={rows}
              promptTextById={promptTextById}
              topCutoff={topCutoff}
              bottomCutoff={bottomCutoff}
            />
          </div>
          <p className="text-xs text-[color:var(--color-muted)] pt-3 border-t border-[color:var(--color-border)]/60">
            High-visibility prompts make good <span className="font-medium">control</span> picks;
            low-visibility ones are the best <span className="font-medium">treatment</span> candidates.
          </p>
        </>
      )}
    </Card>
  );
}

function RankedPromptList({
  rows,
  promptTextById,
  topCutoff,
  bottomCutoff,
}: {
  rows: Array<{ prompt_id: string; visibility: number }>;
  promptTextById: ProjectAnalytics['promptTextById'];
  topCutoff: number;
  bottomCutoff: number;
}) {
  // Split the ranked list into three buckets so each row can carry the
  // right accent without recomputing percentile inside the renderer.
  // The list is already sorted desc, so indices < topCutoff are the
  // top quartile and indices >= total-bottomCutoff are the bottom.
  const total = rows.length;
  const topRows = rows.slice(0, topCutoff);
  const middleRows = rows.slice(topCutoff, Math.max(topCutoff, total - bottomCutoff));
  const bottomRows = rows.slice(Math.max(topCutoff, total - bottomCutoff));

  return (
    <div className="space-y-4">
      {topRows.length > 0 && (
        <ClickablePromptList
          title="Top performing"
          rows={topRows}
          accent="positive"
          promptTextById={promptTextById}
        />
      )}
      {middleRows.length > 0 && (
        <ClickablePromptList
          title="Mid-range"
          rows={middleRows}
          accent="neutral"
          promptTextById={promptTextById}
        />
      )}
      {bottomRows.length > 0 && (
        <ClickablePromptList
          title="Under-performing"
          rows={bottomRows}
          accent="negative"
          promptTextById={promptTextById}
        />
      )}
    </div>
  );
}

// EngineCoverageCard now lives in ./engine-coverage-card.tsx — it became a
// client component to support the "show zero-coverage engines" toggle.
export { EngineCoverageCard } from '@/components/engine-coverage-card';

export function TopUrlsCard({ topUrls }: { topUrls: ProjectAnalytics['topUrls'] }) {
  const ranked = [...topUrls]
    .filter((u) => typeof u.url === 'string')
    .sort((a, b) => (b.citation_rate ?? 0) - (a.citation_rate ?? 0))
    .slice(0, 8);

  return (
    <Card
      title="Top cited URLs"
      hint="Pages Peec already sees being cited — strong treatment candidates"
    >
      {ranked.length === 0 ? (
        <EmptyState
          title="No URL data yet"
          description="Run a domain in Peec for at least one day to populate this."
        />
      ) : (
        <div className="overflow-hidden rounded-md border border-[color:var(--color-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[color:var(--color-border)]/30 text-[10px] uppercase text-[color:var(--color-muted)]">
              <tr>
                <th className="text-left p-2 font-medium">URL</th>
                <th className="text-right p-2 font-medium">Citation</th>
                <th className="text-right p-2 font-medium">Retrieval</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((u) => (
                <tr
                  key={u.url}
                  className="border-t border-[color:var(--color-border)]/60"
                >
                  <td className="p-2 truncate max-w-[320px]">
                    <a
                      href={u.url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      {u.url}
                    </a>
                  </td>
                  <td className="p-2 text-right tabular-nums text-xs">
                    {u.citation_rate != null ? `${(u.citation_rate * 100).toFixed(1)}%` : '—'}
                  </td>
                  <td className="p-2 text-right tabular-nums text-xs">
                    {u.retrieval_rate != null ? `${(u.retrieval_rate * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/**
 * SuggestedActionsCard — Peec's own AI-recommended next actions for the
 * project (from get_actions(scope='overview')).
 *
 * Replaces the old TopicsTagsCard. Topics & tags are descriptive metadata
 * that didn't drive any decision on their own; suggested actions are
 * prescriptive — every row is a candidate experiment ("fix this URL",
 * "add this prompt", etc.). Sorted high → medium → low; rows with a
 * `url` link out to the page that needs work.
 *
 * Renders nothing if Peec returned no actions, so older workspaces that
 * don't expose get_actions stay clean.
 */
export function SuggestedActionsCard({ actions }: { actions: SuggestedAction[] }) {
  if (actions.length === 0) {
    return null;
  }
  const order: Record<NonNullable<SuggestedAction['priority']>, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  const sorted = [...actions].sort((a, b) => {
    const ap = order[a.priority ?? 'low'] ?? 3;
    const bp = order[b.priority ?? 'low'] ?? 3;
    return ap - bp;
  });
  return (
    <Card
      title="Suggested actions"
      hint="From Peec · each is a candidate experiment"
    >
      <ul className="divide-y divide-[color:var(--color-border)]/60">
        {sorted.slice(0, 8).map((a, i) => (
          <li key={`${a.title}-${i}`} className="py-2.5 first:pt-0 last:pb-0 flex items-start gap-3">
            <PriorityBadge priority={a.priority} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium leading-snug">{a.title}</div>
              {a.description && (
                <p className="text-xs text-[color:var(--color-muted)] mt-0.5 line-clamp-2">
                  {a.description}
                </p>
              )}
              {a.url && (
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block mt-1 text-xs text-[color:var(--color-accent)] hover:underline truncate max-w-full"
                >
                  {a.url} ↗
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * "Demand signal" card — backed by Peec's `list_search_queries` cache.
 * Shows the top fan-out queries real users are asking AI engines about
 * in this project's window so the user can pick treatment / control
 * prompts grounded in actual demand, not just what's already tracked.
 *
 * Hidden entirely on workspaces whose Peec install doesn't expose the
 * endpoint (the syncer tolerates the failure → empty array → null).
 */
export function DemandSignalCard({
  searchQueries,
}: {
  searchQueries: ProjectAnalytics['searchQueries'];
}) {
  if (searchQueries.length === 0) return null;
  const top = searchQueries.slice(0, 8);
  const maxVolume = Math.max(...top.map((q) => q.volume ?? 0), 1);
  return (
    <Card
      title="Top fan-out queries"
      hint="From Peec · list_search_queries (last 14d)"
    >
      <ul className="space-y-2">
        {top.map((q) => {
          const pct = q.volume != null ? (q.volume / maxVolume) * 100 : 0;
          return (
            <li key={q.query} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium leading-snug truncate">
                  {q.query}
                </span>
                {q.volume != null && (
                  <span className="text-[11px] tabular-nums text-[color:var(--color-muted)]">
                    {q.volume.toLocaleString()}
                  </span>
                )}
              </div>
              {q.volume != null && (
                <div
                  className="h-1.5 rounded-full bg-[color:var(--color-border)]/60 overflow-hidden"
                  aria-hidden
                >
                  <div
                    className="h-full bg-[color:var(--color-accent)]/70"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function PriorityBadge({ priority }: { priority?: SuggestedAction['priority'] }) {
  const cls =
    priority === 'high'
      ? 'bg-red-100 text-red-900'
      : priority === 'medium'
        ? 'bg-amber-100 text-amber-900'
        : 'bg-zinc-100 text-zinc-700';
  return (
    <span
      className={`mt-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${cls}`}
    >
      {priority ?? 'low'}
    </span>
  );
}

function Card({
  id,
  title,
  hint,
  children,
}: {
  id?: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="rounded-lg border border-[color:var(--color-border)] p-4 space-y-3 scroll-mt-6"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-[color:var(--color-muted)]">
          {title}
        </h2>
        {hint && (
          <span className="text-[11px] text-[color:var(--color-muted)]">{hint}</span>
        )}
      </div>
      {children}
    </section>
  );
}
