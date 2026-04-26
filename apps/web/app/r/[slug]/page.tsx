import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getExperimentByShareSlug } from '@/lib/data';

export const dynamic = 'force-dynamic';
import { EngineLiftBarChart } from '@/components/engine-lift-bar-chart';
import { ExperimentStatusPill } from '@/components/experiment-status-pill';
import { MarkdownReport } from '@/components/markdown-report';
import { RecommendationsPanel, type Recommendation } from '@/components/recommendations-panel';
import { formatPpDelta, SHARE_INTENT_TEMPLATE, WATERMARK_HREF, WATERMARK_TEXT } from '@peec-lab/ui';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const exp = await getExperimentByShareSlug(slug);
  if (!exp) return { title: 'Result not found' };
  return {
    title: `${exp.name} — Peec Experiment Lab`,
    description: exp.hypothesis,
    openGraph: {
      images: [
        {
          url: `/api/og/r/${slug}`,
          width: 1200,
          height: 630,
        },
      ],
    },
  };
}

export default async function PublicResultPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const exp = await getExperimentByShareSlug(slug);
  if (!exp) notFound();

  const liftRows = exp.result
    ? Object.entries(
        (exp.result.liftByEngine ?? {}) as Record<
          string,
          {
            lift_pp: number;
            ci_low: number;
            ci_high: number;
            p_value_corrected?: number;
          }
        >,
      ).map(([engine, l]) => ({
        engine,
        lift_pp: l.lift_pp,
        ci_low: l.ci_low,
        ci_high: l.ci_high,
        significant: (l.p_value_corrected ?? 1) < 0.05,
      }))
    : [];

  const bestLift = liftRows.find((r) => r.significant && r.lift_pp > 0);
  const verdictLine = bestLift
    ? `${exp.name}: ${formatPpDelta(bestLift.lift_pp / 100)} on ${bestLift.engine}`
    : exp.name;

  const shareUrl = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/r/${slug}`
    : `/r/${slug}`;
  const shareIntent = SHARE_INTENT_TEMPLATE(shareUrl, verdictLine);
  const tweet = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareIntent)}`;
  const linkedin = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-3xl p-8 space-y-8">
        <header className="space-y-3">
          <ExperimentStatusPill status={exp.status} />
          <h1 className="text-3xl font-semibold tracking-tight">{exp.name}</h1>
          <p className="text-[color:var(--color-muted)]">{exp.hypothesis}</p>
          <div className="text-xs text-[color:var(--color-muted)]">
            Treatment URL:{' '}
            <a href={exp.treatmentUrl} className="underline" rel="nofollow noopener">
              {exp.treatmentUrl}
            </a>
          </div>
        </header>

        {exp.result && (
          <>
            <section className="rounded-lg border border-[color:var(--color-border)] p-4">
              <h2 className="text-sm font-medium uppercase tracking-wider text-[color:var(--color-muted)] mb-3">
                Verdict: {exp.result.verdict}
              </h2>
              <EngineLiftBarChart rows={liftRows} />
              <p className="text-xs text-[color:var(--color-muted)] mt-2">
                10,000-permutation test, Bonferroni-corrected across {liftRows.length} engines.
                Best corrected p-value: {exp.result.overallPValue.toFixed(4)}.
              </p>
            </section>

            {(() => {
              const recs = ((exp.result?.recommendations ?? []) as unknown[]).filter(
                (r): r is Recommendation =>
                  typeof r === 'object' &&
                  r !== null &&
                  typeof (r as Recommendation).title === 'string',
              );
              if (recs.length === 0) return null;
              return (
                <section className="space-y-3">
                  <h2 className="text-sm font-medium uppercase tracking-wider text-[color:var(--color-muted)]">
                    Recommended next steps
                  </h2>
                  <RecommendationsPanel items={recs} />
                </section>
              );
            })()}

            <section className="rounded-lg border border-[color:var(--color-border)] p-5">
              <h2 className="text-sm font-medium uppercase tracking-wider text-[color:var(--color-muted)] mb-3">
                Report
              </h2>
              <MarkdownReport markdown={exp.result.reportMarkdown} />
            </section>
          </>
        )}

        <section className="flex flex-wrap items-center gap-3">
          <a
            href={tweet}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-[color:var(--color-accent)] px-3 py-2 text-sm font-medium text-[color:var(--color-accent-fg)]"
          >
            Share on X
          </a>
          <a
            href={linkedin}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-[color:var(--color-border)] px-3 py-2 text-sm font-medium"
          >
            Share on LinkedIn
          </a>
          <a
            href={WATERMARK_HREF}
            className="ml-auto text-xs text-[color:var(--color-muted)] underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {WATERMARK_TEXT}
          </a>
        </section>

        <footer className="pt-6 border-t border-[color:var(--color-border)] text-xs text-[color:var(--color-muted)]">
          Built with{' '}
          <Link href="/" className="underline">
            Peec Experiment Lab
          </Link>{' '}
          on the Peec MCP Challenge.
        </footer>
      </div>
    </main>
  );
}
