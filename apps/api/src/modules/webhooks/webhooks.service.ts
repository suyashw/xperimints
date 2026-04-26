import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@peec-lab/database';
import { parseExperimentYaml } from '@peec-lab/shared';
import { PRISMA } from '../../prisma/prisma.module.js';
import { ExperimentsService } from '../experiments/experiments.service.js';
import { PowerAnalysisService } from '../analysis/power-analysis.service.js';
import { SnapshotsService } from '../snapshots/snapshots.service.js';
import { GitHubService } from '../notifications/github.service.js';

const EXPERIMENT_LABEL = 'geo-experiment';
const EXPERIMENT_YAML_PATH = 'experiment.yaml';

/**
 * Webhook processor — owns the boundary between external systems and the
 * experiment lifecycle (PLAN.md §5.7).
 *
 *   GitHub PR opened with `geo-experiment` label
 *     → fetch experiment.yaml from PR head
 *     → validate against the schema (comment errors back if invalid)
 *     → ExperimentsService.createFromYaml (which also creates Peec topic + tag)
 *     → PowerAnalysisService.estimateForExperiment
 *     → comment back on the PR with the verdict
 *
 *   GitHub PR merged
 *     → ensure the matching DRAFT experiment is bumped to SCHEDULED, awaiting
 *       a Vercel deploy webhook to flip it to RUNNING.
 *
 *   Vercel deployment.succeeded for production
 *     → match by SHA → SCHEDULED → RUNNING + snapshot the live treatment URL.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly experiments: ExperimentsService,
    private readonly power: PowerAnalysisService,
    private readonly snapshots: SnapshotsService,
    private readonly github: GitHubService,
  ) {}

  // ── Signature verification ────────────────────────────────────────────────

  verifyGithub(rawBody: string, signature: string | undefined): boolean {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) return true; // dev bypass
    if (!signature) return false;
    const expected =
      'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
    return safeEqual(expected, signature);
  }

  verifyVercel(rawBody: string, signature: string | undefined): boolean {
    const secret = process.env.VERCEL_WEBHOOK_SECRET;
    if (!secret) return true;
    if (!signature) return false;
    const expected = createHmac('sha1', secret).update(rawBody, 'utf8').digest('hex');
    return safeEqual(expected, signature);
  }

  async logAndStash(args: {
    source: 'github' | 'vercel';
    eventType: string | undefined;
    headers: Record<string, unknown>;
    body: unknown;
    signature?: string;
  }) {
    return this.prisma.webhookLog.create({
      data: {
        source: args.source,
        eventType: args.eventType ?? null,
        headers: args.headers as object,
        body: args.body as object,
        signature: args.signature ?? null,
      },
    });
  }

  // ── GitHub: pull_request handler ──────────────────────────────────────────

  /**
   * Handle a `pull_request` event. We only act on action ∈ {opened, synchronize,
   * reopened, labeled} when the PR carries the `geo-experiment` label, plus
   * `closed{merged: true}` regardless of label (so we can transition existing
   * experiments to SCHEDULED).
   *
   * Returns a small summary of what we did so the caller can log it.
   */
  async handleGithubPullRequest(payload: GithubPullRequestPayload): Promise<{
    action: string;
    experimentId?: string;
    error?: string;
    skipped?: string;
  }> {
    const action = payload.action;
    const pr = payload.pull_request;
    if (!pr) return { action, skipped: 'no pull_request in payload' };

    const repoFull = payload.repository?.full_name;
    const [owner, repo] = (repoFull ?? '').split('/');
    if (!owner || !repo) return { action, skipped: 'missing repository.full_name' };

    const labelNames = (pr.labels ?? []).map((l) => l.name?.toLowerCase());
    const hasLabel = labelNames.includes(EXPERIMENT_LABEL);

    // Closed + merged → arm any matching DRAFT experiment for Vercel deploy.
    if (action === 'closed' && pr.merged) {
      return this.handlePrMerged({ owner, repo, pr });
    }

    // Otherwise: only react when the PR carries the geo-experiment label.
    if (!hasLabel) return { action, skipped: `PR not labelled '${EXPERIMENT_LABEL}'` };
    if (!['opened', 'synchronize', 'reopened', 'labeled'].includes(action)) {
      return { action, skipped: `action '${action}' not actionable` };
    }

    return this.ingestExperimentFromPr({ owner, repo, pr });
  }

  private async ingestExperimentFromPr(args: {
    owner: string;
    repo: string;
    pr: GithubPr;
  }): Promise<{ action: string; experimentId?: string; error?: string; skipped?: string }> {
    const { owner, repo, pr } = args;
    const sha = pr.head?.sha;
    const prUrl = pr.html_url;
    if (!sha || !prUrl) return { action: 'invalid', error: 'PR missing head.sha or html_url' };

    // Pull the experiment.yaml from the PR head.
    let raw: string | null = null;
    try {
      raw = await this.github.fetchFileFromRef({
        owner,
        repo,
        ref: sha,
        path: EXPERIMENT_YAML_PATH,
      });
    } catch (err) {
      const msg = `Failed to fetch ${EXPERIMENT_YAML_PATH}: ${(err as Error).message}`;
      this.logger.warn(msg);
      await this.github
        .commentOnPr({ owner, repo, prNumber: pr.number, body: prCommentError(msg) })
        .catch(() => {});
      return { action: pr.action ?? 'opened', error: msg };
    }
    if (!raw) {
      return { action: 'no-yaml', skipped: `${EXPERIMENT_YAML_PATH} not present in PR head` };
    }

    const parsed = parseExperimentYaml(raw);
    if (!parsed.ok) {
      const body = prCommentInvalidYaml(parsed.errors);
      await this.github
        .commentOnPr({ owner, repo, prNumber: pr.number, body })
        .catch((e) => this.logger.warn(`PR comment failed: ${(e as Error).message}`));
      return { action: 'invalid-yaml', error: parsed.errors.map((e) => e.message).join('; ') };
    }

    // We resolve the org by convention: pick the oldest org that has a
    // PeecProject so the webhook handler attaches PR-driven experiments
    // to a real workspace. Operators running the webhook pipeline today
    // are still single-user dev installs; multi-repo → multi-tenant
    // resolution lands when GitHub installations carry an org id.
    const { organizationId, peecProjectId } = await this.resolveSoloOrgAndProject();

    // Idempotency: if we already have an experiment with this shareSlug
    // (== experiment.yaml `id`) for this org, do nothing for opened/labeled,
    // but on synchronize we should refresh the SHA / re-baseline.
    const existing = await this.prisma.experiment.findFirst({
      where: { organizationId, shareSlug: parsed.data.id },
    });
    let experimentId: string;
    if (existing) {
      // Update SHA + PR URL only — do not transition.
      await this.prisma.experiment.update({
        where: { id: existing.id },
        data: { githubPrSha: sha, githubPrUrl: prUrl },
      });
      experimentId = existing.id;
    } else {
      const created = await this.experiments.createFromYaml({
        organizationId,
        peecProjectId,
        yaml: parsed.data,
        githubPrUrl: prUrl,
        githubPrSha: sha,
      });
      experimentId = created.id;
    }

    // Run power analysis (best-effort).
    let powerLine = '_Power analysis unavailable._';
    try {
      const r = await this.power.estimateForExperiment(experimentId);
      powerLine = r.message;
      await this.prisma.experimentEvent.create({
        data: {
          experimentId,
          type: 'POWER_ANALYZED',
          payload: { ...r },
        },
      });
    } catch (err) {
      this.logger.warn(`Power analysis failed: ${(err as Error).message}`);
    }

    // Comment back.
    const body = prCommentReceived({
      slug: parsed.data.id,
      name: parsed.data.name,
      hypothesis: parsed.data.hypothesis,
      minLiftPp: parsed.data.min_lift_pp,
      treatmentUrl: parsed.data.treatment_url,
      treatmentArmSize: parsed.data.treatment_prompts.length,
      controlArmSize: parsed.data.control_prompts.length,
      powerLine,
      shareSlug: parsed.data.id,
      isPublic: parsed.data.share === 'public',
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? null,
    });
    const comment = await this.github
      .commentOnPr({ owner, repo, prNumber: pr.number, body })
      .catch((e) => {
        this.logger.warn(`PR comment failed: ${(e as Error).message}`);
        return null;
      });
    if (comment) {
      await this.prisma.experimentEvent.create({
        data: {
          experimentId,
          type: 'PR_COMMENTED',
          payload: { url: comment.html_url, kind: 'received' },
        },
      });
    }

    return { action: pr.action ?? 'opened', experimentId };
  }

  private async handlePrMerged(args: {
    owner: string;
    repo: string;
    pr: GithubPr;
  }): Promise<{ action: string; experimentId?: string; skipped?: string }> {
    const sha = args.pr.head?.sha;
    const prUrl = args.pr.html_url;
    // Find the most recently-created DRAFT experiment matching this PR.
    const exp = await this.prisma.experiment.findFirst({
      where: {
        status: 'DRAFT',
        OR: [
          ...(prUrl ? [{ githubPrUrl: prUrl }] : []),
          ...(sha ? [{ githubPrSha: sha }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!exp) return { action: 'closed', skipped: 'no matching DRAFT experiment' };
    await this.experiments.transition(exp.id, 'DRAFT', 'SCHEDULED', 'CREATED', {
      mergedAt: new Date().toISOString(),
      sha,
    });
    return { action: 'closed', experimentId: exp.id };
  }

  private async resolveSoloOrgAndProject(): Promise<{
    organizationId: string;
    peecProjectId: string;
  }> {
    const proj = await this.prisma.peecProject.findFirst({
      orderBy: { lastSyncedAt: 'desc' },
      select: { id: true, organizationId: true },
    });
    if (!proj) {
      throw new Error(
        'No PeecProject in the database. Sign up at /signup, connect Peec, and refresh once before pushing the PR.',
      );
    }
    return { organizationId: proj.organizationId, peecProjectId: proj.id };
  }

  // ── Vercel: deployment.succeeded ─────────────────────────────────────────

  /** Vercel `deployment.succeeded` for production → flip the matching experiment to RUNNING. */
  async handleVercelDeploymentSucceeded(payload: {
    deploymentId?: string;
    target?: string;
    meta?: { githubCommitSha?: string };
  }) {
    if (payload.target !== 'production' || !payload.meta?.githubCommitSha) return null;
    const sha = payload.meta.githubCommitSha;
    const exp = await this.prisma.experiment.findFirst({
      where: { status: 'SCHEDULED', githubPrSha: sha },
    });
    if (!exp) return null;
    const now = new Date();
    await this.prisma.experiment.update({
      where: { id: exp.id },
      data: {
        launchAt: now,
        endsAt: addDays(now, exp.durationDays),
        vercelDeploymentId: payload.deploymentId,
      },
    });
    await this.experiments.transition(exp.id, 'SCHEDULED', 'RUNNING', 'LAUNCHED', {
      deploymentId: payload.deploymentId,
    });
    // PLAN.md §5.7: snapshot the live treatment URL the moment it ships.
    await this.snapshots
      .snapshotTreatmentUrlContent(exp.id, 'before')
      .catch((e) => this.logger.warn(`url-content snapshot failed: ${(e as Error).message}`));
    return exp.id;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

interface GithubPr {
  action?: string;
  number: number;
  html_url: string;
  merged?: boolean;
  labels?: Array<{ name: string }>;
  head?: { sha: string; ref?: string };
  base?: { ref?: string };
}

interface GithubPullRequestPayload {
  action: string;
  pull_request?: GithubPr;
  repository?: { full_name?: string };
}

// ── PR comment renderers ──────────────────────────────────────────────────

function prCommentReceived(args: {
  slug: string;
  name: string;
  hypothesis: string;
  minLiftPp: number;
  treatmentUrl: string;
  treatmentArmSize: number;
  controlArmSize: number;
  powerLine: string;
  shareSlug: string;
  isPublic: boolean;
  appUrl: string | null;
}): string {
  const detailLink = args.appUrl ? `${args.appUrl}/r/${args.shareSlug}` : `/r/${args.shareSlug}`;
  return [
    `### 🧪 Peec Experiment Lab — \`${args.slug}\` registered`,
    '',
    `**${args.name}**`,
    '',
    `> ${args.hypothesis}`,
    '',
    `- **Treatment URL:** ${args.treatmentUrl}`,
    `- **Treatment / control prompts:** ${args.treatmentArmSize} / ${args.controlArmSize}`,
    `- **Minimum detectable lift:** ${args.minLiftPp}pp`,
    '',
    `**Power analysis:** ${args.powerLine}`,
    '',
    args.isPublic
      ? `Once this PR merges and the production deploy succeeds, daily snapshots begin and the result will appear at [${detailLink}](${detailLink}).`
      : 'Once this PR merges and the production deploy succeeds, daily snapshots begin.',
    '',
    '<sub>#BuiltWithPeec — automated by [peec-experiment-lab](https://peec.ai/mcp-challenge).</sub>',
  ].join('\n');
}

function prCommentInvalidYaml(
  errors: ReadonlyArray<{ path: string; message: string }>,
): string {
  return [
    `### ⚠️ \`${EXPERIMENT_YAML_PATH}\` failed validation`,
    '',
    'The Peec Experiment Lab found the following issues:',
    '',
    ...errors.map((e) => `- \`${e.path || '(root)'}\`: ${e.message}`),
    '',
    'Fix these and push again — this PR comment will refresh automatically.',
    '',
    '<sub>Schema reference: see PLAN.md §9 in the lab repo.</sub>',
  ].join('\n');
}

function prCommentError(msg: string): string {
  return [
    `### ⚠️ Peec Experiment Lab couldn't process this PR`,
    '',
    '```',
    msg,
    '```',
  ].join('\n');
}
