import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PrismaClient, Verdict } from '@peec-lab/database';
import { formatPpDelta } from '@peec-lab/ui';
import { PRISMA } from '../../prisma/prisma.module.js';
import { GitHubService, parsePrUrl } from '../notifications/github.service.js';
import { LinearService } from '../notifications/linear.service.js';

/**
 * Closes the loop on a finalized experiment: drops a Linear ticket and posts
 * a verdict comment back on the originating PR. Both calls are best-effort —
 * a notification failure must never roll back the persisted ExperimentResult.
 *
 * Lives in JobsModule (rather than NotificationsModule) because it composes
 * GitHubService + LinearService into a verdict-shaped workflow.
 */
@Injectable()
export class VerdictNotifierService {
  private readonly logger = new Logger(VerdictNotifierService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly github: GitHubService,
    private readonly linear: LinearService,
  ) {}

  async notify(experimentId: string): Promise<{
    linearIssueUrl: string | null;
    prCommentUrl: string | null;
  }> {
    const exp = await this.prisma.experiment.findUnique({
      where: { id: experimentId },
      include: { result: true },
    });
    if (!exp || !exp.result) {
      this.logger.warn(`notify(${experimentId}): no result yet, skipping`);
      return { linearIssueUrl: null, prCommentUrl: null };
    }

    const verdict = exp.result.verdict as Verdict;
    const lifts = (exp.result.liftByEngine ?? {}) as Record<
      string,
      { lift_pp: number; ci_low: number; ci_high: number; p_value_corrected?: number }
    >;
    const best = Object.entries(lifts)
      .filter(([, l]) => (l.p_value_corrected ?? 1) < 0.05)
      .sort(([, a], [, b]) => Math.abs(b.lift_pp) - Math.abs(a.lift_pp))[0];
    const headline = best
      ? `${formatPpDelta(best[1].lift_pp / 100)} on ${best[0]}`
      : 'no engine reached significance';

    const shareUrl = exp.isPublic
      ? `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/r/${exp.shareSlug}`
      : null;

    // ── Linear ────────────────────────────────────────────────────────────
    let linearIssueUrl: string | null = null;
    if (this.linear.enabled() && process.env.LINEAR_TEAM_ID) {
      try {
        const issue = await this.linear.createIssue({
          title: `[Experiment ${verdict}] ${exp.name}: ${headline}`,
          description: linearBody({
            verdict,
            headline,
            hypothesis: exp.hypothesis,
            treatmentUrl: exp.treatmentUrl,
            shareUrl,
            lifts,
            overallPValue: exp.result.overallPValue,
            reportMarkdown: exp.result.reportMarkdown,
          }),
        });
        if (issue) {
          linearIssueUrl = issue.url;
          await this.prisma.experimentEvent.create({
            data: {
              experimentId,
              type: 'LINEAR_TICKET_CREATED',
              payload: { url: issue.url, identifier: issue.identifier },
            },
          });
        }
      } catch (err) {
        this.logger.warn(`Linear notify failed: ${(err as Error).message}`);
      }
    }

    // ── GitHub PR comment ─────────────────────────────────────────────────
    let prCommentUrl: string | null = null;
    const pr = parsePrUrl(exp.githubPrUrl);
    if (pr && this.github.enabled()) {
      try {
        const comment = await this.github.commentOnPr({
          owner: pr.owner,
          repo: pr.repo,
          prNumber: pr.prNumber,
          body: prVerdictBody({
            verdict,
            headline,
            lifts,
            shareUrl,
            linearIssueUrl,
            overallPValue: exp.result.overallPValue,
          }),
        });
        if (comment) {
          prCommentUrl = comment.html_url;
          await this.prisma.experimentEvent.create({
            data: {
              experimentId,
              type: 'PR_COMMENTED',
              payload: { url: comment.html_url, kind: 'verdict' },
            },
          });
        }
      } catch (err) {
        this.logger.warn(`PR comment (verdict) failed: ${(err as Error).message}`);
      }
    }

    return { linearIssueUrl, prCommentUrl };
  }
}

function emoji(v: Verdict): string {
  return v === 'WIN' ? '✅' : v === 'LOSS' ? '❌' : '🟡';
}

function liftTable(
  lifts: Record<string, { lift_pp: number; ci_low: number; ci_high: number; p_value_corrected?: number }>,
): string {
  const rows = Object.entries(lifts).map(
    ([engine, l]) =>
      `| \`${engine}\` | ${formatPpDelta(l.lift_pp / 100)} | [${l.ci_low.toFixed(2)}pp, ${l.ci_high.toFixed(2)}pp] | ${(l.p_value_corrected ?? 1).toFixed(4)} |`,
  );
  return ['| Engine | Lift | 95% CI | Corrected p |', '|---|---|---|---|', ...rows].join('\n');
}

function linearBody(args: {
  verdict: Verdict;
  headline: string;
  hypothesis: string;
  treatmentUrl: string;
  shareUrl: string | null;
  lifts: Record<string, { lift_pp: number; ci_low: number; ci_high: number; p_value_corrected?: number }>;
  overallPValue: number;
  reportMarkdown: string;
}): string {
  return [
    `## ${emoji(args.verdict)} Verdict: ${args.verdict} — ${args.headline}`,
    '',
    `> ${args.hypothesis}`,
    '',
    `**Treatment URL:** ${args.treatmentUrl}`,
    `**Best corrected p-value:** ${args.overallPValue.toFixed(4)}`,
    args.shareUrl ? `**Public result:** ${args.shareUrl}` : '',
    '',
    '### Per-engine lift',
    liftTable(args.lifts),
    '',
    '### Recommendation',
    args.verdict === 'WIN'
      ? '**Roll forward.** Apply the same change pattern to comparable URLs in the next sprint.'
      : args.verdict === 'LOSS'
        ? '**Roll back or iterate.** This change is significantly hurting visibility.'
        : '**Extend or refine.** Either lower `min_lift_pp` or extend the experiment window.',
    '',
    '<details><summary>Full report</summary>',
    '',
    args.reportMarkdown,
    '',
    '</details>',
    '',
    '— Posted automatically by **peec-experiment-lab**. #BuiltWithPeec',
  ]
    .filter(Boolean)
    .join('\n');
}

function prVerdictBody(args: {
  verdict: Verdict;
  headline: string;
  lifts: Record<string, { lift_pp: number; ci_low: number; ci_high: number; p_value_corrected?: number }>;
  shareUrl: string | null;
  linearIssueUrl: string | null;
  overallPValue: number;
}): string {
  return [
    `### ${emoji(args.verdict)} Experiment verdict: **${args.verdict}** — ${args.headline}`,
    '',
    `Best corrected p-value: \`${args.overallPValue.toFixed(4)}\` (10,000-permutation test, Bonferroni-corrected).`,
    '',
    liftTable(args.lifts),
    '',
    args.shareUrl ? `📊 Public report: ${args.shareUrl}` : '',
    args.linearIssueUrl ? `📋 Linear ticket: ${args.linearIssueUrl}` : '',
    '',
    '<sub>#BuiltWithPeec — automated by [peec-experiment-lab](https://peec.ai/mcp-challenge).</sub>',
  ]
    .filter(Boolean)
    .join('\n');
}
