import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getCurrentOrg, getExperimentDetail } from '@/lib/data';

export const dynamic = 'force-dynamic';
import { ExperimentStatusPill } from '@/components/experiment-status-pill';
import { LiftSparkline } from '@/components/lift-sparkline';
import { EngineLiftBarChart } from '@/components/engine-lift-bar-chart';
import { ExperimentTimeline } from '@/components/experiment-timeline';
import { ShareButton } from '@/components/share-button';
import { EmptyState } from '@/components/empty-state';
import { MarkdownReport } from '@/components/markdown-report';
import { PowerAnalysisCard } from '@/components/power-analysis-card';
import { formatPpDelta } from '@peec-lab/ui';

export default async function ExperimentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const org = await getCurrentOrg();
  if (!org) notFound();
  const exp = await getExperimentDetail(org.id, id);
  if (!exp) notFound();

  // Build per-engine sparklines from snapshots.
  const treatmentSet = new Set(exp.treatmentPromptIds);
  const series = new Map<string, Array<{ t: string; v: number }>>();
  for (const snap of exp.snapshots) {
    const matrix = snap.brandMetrics as unknown as Record<
      string,
      Record<string, { visibility?: number }>
    >;
    const perEngine: Record<string, { sum: number; n: number }> = {};
    for (const [pid, byEngine] of Object.entries(matrix ?? {})) {
      if (!treatmentSet.has(pid)) continue;
      for (const [eid, cell] of Object.entries(byEngine)) {
        if (typeof cell?.visibility !== 'number') continue;
        const cur = perEngine[eid] ?? { sum: 0, n: 0 };
        cur.sum += cell.visibility;
        cur.n += 1;
        perEngine[eid] = cur;
      }
    }
    const t = new Date(snap.capturedAt).toISOString();
    for (const [eid, agg] of Object.entries(perEngine)) {
      const list = series.get(eid) ?? [];
      list.push({ t, v: agg.sum / agg.n });
      series.set(eid, list);
    }
  }

  const result = exp.result;
  const liftRows = result
    ? Object.entries((result.liftByEngine ?? {}) as Record<string, {
        lift_pp: number;
        ci_low: number;
        ci_high: number;
        p_value_corrected?: number;
      }>).map(([engine, l]) => ({
        engine,
        lift_pp: l.lift_pp,
        ci_low: l.ci_low,
        ci_high: l.ci_high,
        significant: (l.p_value_corrected ?? 1) < 0.05,
      }))
    : [];
  const bestSig = liftRows
    .filter((r) => r.significant)
    .sort((a, b) => Math.abs(b.lift_pp) - Math.abs(a.lift_pp))[0];
  const verdictLine = bestSig
    ? `${exp.name}: ${formatPpDelta(bestSig.lift_pp / 100)} on ${bestSig.engine}`
    : exp.name;
  const shareUrl = exp.isPublic
    ? `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/r/${exp.shareSlug}`
    : `/r/${exp.shareSlug}`;

  // Most-recent power-analysis result (emitted by the GitHub PR webhook).
  const powerEvent = [...exp.events]
    .reverse()
    .find((ev) => ev.type === 'POWER_ANALYZED');
  const power = powerEvent?.payload as
    | { power?: number; recommendedDays?: number | null; block?: boolean; achievable?: boolean; message?: string }
    | undefined;

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-8">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <ExperimentStatusPill status={exp.status} />
          <span className="text-xs text-[color:var(--color-muted)]">
            Min lift {exp.minLiftPp}pp · seed {exp.randomSeed}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {result && (
              <Link
                href={`/experiments/${exp.id}/result`}
                className="rounded-md border border-[color:var(--color-border)] px-2.5 py-1 text-xs font-medium hover:border-[color:var(--color-accent)]"
              >
                Full result →
              </Link>
            )}
            <ShareButton
              shareUrl={shareUrl}
              verdictLine={verdictLine}
              isPublic={exp.isPublic}
            />
          </div>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{exp.name}</h1>
        <p className="text-sm text-[color:var(--color-muted)] max-w-2xl">{exp.hypothesis}</p>
        <div className="text-xs text-[color:var(--color-muted)]">
          Treatment URL:{' '}
          <a href={exp.treatmentUrl} className="underline">
            {exp.treatmentUrl}
          </a>
        </div>
        {['RUNNING', 'SCHEDULED'].includes(exp.status) && (
          <p className="text-xs text-[color:var(--color-muted)] italic">
            Auto-snapshots run at 06:00 UTC daily (Vercel Hobby cron). Need fresher data right
            now? Use Refresh.
          </p>
        )}
        {exp.status === 'RUNNING' && exp.snapshots.length === 0 && (
          <p className="text-xs text-[color:var(--color-muted)] italic">
            Day-0 baseline finalises at 06:00 UTC tomorrow (Peec ingests with a ~24h delay).
          </p>
        )}
      </header>

      {power && typeof power.power === 'number' && (
        <PowerAnalysisCard
          power={power.power}
          recommendedDays={power.recommendedDays ?? null}
          block={Boolean(power.block)}
          achievable={Boolean(power.achievable)}
          message={power.message ?? ''}
          minLiftPp={exp.minLiftPp}
        />
      )}

      {liftRows.length > 0 && (
        <section className="rounded-lg border border-[color:var(--color-border)] p-4">
          <h2 className="text-sm font-medium uppercase tracking-wider text-[color:var(--color-muted)] mb-3">
            Per-engine lift (95% CI)
          </h2>
          <EngineLiftBarChart rows={liftRows} />
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wider text-[color:var(--color-muted)]">
          Treatment-arm visibility (per engine)
        </h2>
        {series.size === 0 ? (
          <EmptyState
            title="No snapshots yet"
            description="Daily snapshots run at 06:00 UTC; the first arrives within ~24h of launch. Use Refresh to pull one early."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from(series.entries()).map(([engine, points]) => {
              const last = points.at(-1)?.v ?? 0;
              const first = points.at(0)?.v ?? 0;
              const delta = last - first;
              return (
                <div
                  key={engine}
                  className="rounded-lg border border-[color:var(--color-border)] p-3"
                >
                  <div className="flex items-baseline justify-between mb-1">
                    <code className="text-xs font-medium">{engine}</code>
                    <span
                      className={`text-xs tabular-nums ${
                        delta > 0
                          ? 'text-emerald-600'
                          : delta < 0
                            ? 'text-red-600'
                            : 'text-zinc-500'
                      }`}
                    >
                      {formatPpDelta(delta)}
                    </span>
                  </div>
                  <LiftSparkline data={points} />
                </div>
              );
            })}
          </div>
        )}
      </section>

      {result?.reportMarkdown && (
        <section className="rounded-lg border border-[color:var(--color-border)] p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-medium uppercase tracking-wider text-[color:var(--color-muted)]">
              Verdict report
            </h2>
            <Link
              href={`/experiments/${exp.id}/result`}
              className="text-xs underline text-[color:var(--color-muted)]"
            >
              Open full report →
            </Link>
          </div>
          <MarkdownReport markdown={result.reportMarkdown} />
        </section>
      )}

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-[color:var(--color-muted)] mb-3">
          Timeline
        </h2>
        <ExperimentTimeline events={exp.events} />
      </section>
    </div>
  );
}
