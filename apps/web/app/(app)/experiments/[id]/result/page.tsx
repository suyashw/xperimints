import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getCurrentOrg, getExperimentDetail } from '@/lib/data';
import { ExperimentStatusPill } from '@/components/experiment-status-pill';
import { EngineLiftWithEvidence } from '@/components/engine-lift-with-evidence';
import { MarkdownReport } from '@/components/markdown-report';
import { RecommendationsPanel, type Recommendation } from '@/components/recommendations-panel';
import {
  CompetitorMovementTable,
  type CompetitorRow,
} from '@/components/competitor-movement-table';
import { BeforeAfterDiff } from '@/components/before-after-diff';
import { ShareButton } from '@/components/share-button';
import { EmptyState } from '@/components/empty-state';
import { formatPpDelta } from '@peec-lab/ui';
import type { EvidenceChat } from '@/components/evidence-drawer';

export const dynamic = 'force-dynamic';

export default async function ExperimentResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const org = await getCurrentOrg();
  if (!org) notFound();
  const exp = await getExperimentDetail(org.id, id);
  if (!exp) notFound();

  const result = exp.result;
  const liftByEngine = (result?.liftByEngine ?? {}) as Record<
    string,
    {
      lift_pp: number;
      ci_low: number;
      ci_high: number;
      p_value: number;
      p_value_corrected?: number;
      samples_pre?: number;
      samples_post?: number;
    }
  >;
  const liftRows = Object.entries(liftByEngine).map(([engine, l]) => ({
    engine,
    lift_pp: l.lift_pp,
    ci_low: l.ci_low,
    ci_high: l.ci_high,
    significant: (l.p_value_corrected ?? 1) < 0.05,
  }));
  const bestSignificant = liftRows
    .filter((r) => r.significant)
    .sort((a, b) => Math.abs(b.lift_pp) - Math.abs(a.lift_pp))[0];
  const verdictLine = bestSignificant
    ? `${exp.name}: ${formatPpDelta(bestSignificant.lift_pp / 100)} on ${bestSignificant.engine}`
    : exp.name;

  const recommendations = ((result?.recommendations ?? []) as unknown[]).filter(
    (r): r is Recommendation =>
      typeof r === 'object' && r !== null && typeof (r as Recommendation).title === 'string',
  );

  const competitorMovement = result?.competitorMovement
    ? Object.entries(
        result.competitorMovement as Record<
          string,
          {
            brand_name?: string;
            sov_delta?: number;
            visibility_delta?: number;
            citation_delta?: number;
          }
        >,
      ).map<CompetitorRow>(([brandId, m]) => ({
        brandId,
        brandName: m.brand_name ?? brandId,
        sovDelta: m.sov_delta ?? 0,
        visibilityDelta: m.visibility_delta ?? 0,
        citationDelta: m.citation_delta,
      }))
    : [];

  const evidenceChats = ((result?.evidenceChats ?? []) as unknown[]).filter(
    (c): c is EvidenceChat =>
      typeof c === 'object' &&
      c !== null &&
      typeof (c as EvidenceChat).chat_id === 'string' &&
      typeof (c as EvidenceChat).model_id === 'string',
  );
  // Group evidence by engine.
  const evidenceByEngine: Record<string, EvidenceChat[]> = {};
  for (const c of evidenceChats) {
    (evidenceByEngine[c.model_id] ??= []).push(c);
  }

  const shareUrl = exp.isPublic
    ? `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/r/${exp.shareSlug}`
    : '';

  if (!result) {
    return (
      <div className="mx-auto max-w-5xl p-6 space-y-6">
        <Header exp={exp} verdictLine={verdictLine} shareUrl={shareUrl} />
        <EmptyState
          title="Result not yet computed"
          description="The verdict is computed by the daily finalize cron, the moment endsAt passes. You can also trigger it manually from the experiment detail page."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-8">
      <Header exp={exp} verdictLine={verdictLine} shareUrl={shareUrl} />

      <section className="rounded-lg border border-[color:var(--color-border)] p-4">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2 className="text-sm font-medium uppercase tracking-wider text-[color:var(--color-muted)]">
            Per-engine lift (95% CI)
          </h2>
          <p className="text-xs text-[color:var(--color-muted)]">
            10,000-permutation test · Bonferroni-corrected · seed {exp.randomSeed} · best
            corrected p ={' '}
            <code className="text-[color:var(--color-fg)]">
              {result.overallPValue.toFixed(4)}
            </code>
          </p>
        </div>
        <EngineLiftWithEvidence rows={liftRows} evidenceByEngine={evidenceByEngine} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wider text-[color:var(--color-muted)]">
            Recommended next steps
          </h2>
          <RecommendationsPanel items={recommendations} />
        </section>
        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wider text-[color:var(--color-muted)]">
            Competitor movement
          </h2>
          <CompetitorMovementTable rows={competitorMovement} />
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-[color:var(--color-muted)]">
          Treatment URL — before vs after
        </h2>
        <BeforeAfterDiff
          before={exp.treatmentUrlSnapshotBefore}
          after={exp.treatmentUrlSnapshotAfter}
        />
      </section>

      <section className="rounded-lg border border-[color:var(--color-border)] p-5">
        <h2 className="text-sm font-medium uppercase tracking-wider text-[color:var(--color-muted)] mb-3">
          Full report
        </h2>
        <MarkdownReport markdown={result.reportMarkdown} />
      </section>
    </div>
  );
}

function Header({
  exp,
  verdictLine,
  shareUrl,
}: {
  exp: { id: string; name: string; hypothesis: string; status: import('@peec-lab/database').ExperimentStatus; treatmentUrl: string; isPublic: boolean; shareSlug: string };
  verdictLine: string;
  shareUrl: string;
}) {
  return (
    <header className="space-y-2">
      <div className="flex items-center gap-3">
        <ExperimentStatusPill status={exp.status} />
        <Link
          href={`/experiments/${exp.id}`}
          className="text-xs text-[color:var(--color-muted)] underline"
        >
          ← Back to detail
        </Link>
        <div className="ml-auto">
          <ShareButton
            shareUrl={shareUrl || `/r/${exp.shareSlug}`}
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
    </header>
  );
}
