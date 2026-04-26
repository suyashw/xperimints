/**
 * Integration test for the GitHub PR → experiment ingestion path.
 *
 * Stubs GitHubService so we never touch api.github.com but exercise everything
 * downstream against the live Neon DB:
 *
 *   1. fetchFileFromRef returns a canned experiment.yaml from the PR head.
 *   2. WebhooksService parses it, calls ExperimentsService.createFromYaml
 *      (which auto-creates Peec topic + tag via FakePeecTransport),
 *      runs PowerAnalysisService.estimateForExperiment, and posts a PR comment.
 *   3. We assert the experiment exists with the right shareSlug, the right
 *      events were emitted, and the PR-comment renderer produced a useful
 *      markdown body.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@peec-lab/database';
import { FakePeecTransport, PeecClient } from '@peec-lab/mcp-clients';
import { ExperimentsService } from '../experiments/experiments.service.js';
import { PeecMcpService } from '../peec/peec-mcp.service.js';
import { PowerAnalysisService } from '../analysis/power-analysis.service.js';
import { SnapshotsService } from '../snapshots/snapshots.service.js';
import { GitHubService } from '../notifications/github.service.js';
import { WebhooksService } from './webhooks.service.js';

const skipIfNoDb = !process.env.DATABASE_URL ? describe.skip : describe;
const TIMEOUT_MS = 30_000;

const VALID_YAML = `
id: pr-ingest-test
name: "Smoke test from a fake PR"
hypothesis: "If everything works, this test creates an experiment via webhook ingestion."
treatment_url: https://example.com/pr-test
treatment_prompts:
  - prompt_id: prm_t1
control_prompts:
  - prompt_id: prm_c1
engines: [perplexity, chatgpt]
min_lift_pp: 4
duration_days: auto
share: public
`;

const PR_PAYLOAD = {
  action: 'opened',
  pull_request: {
    number: 42,
    html_url: 'https://github.com/acme/site/pull/42',
    head: { sha: 'deadbeefdeadbeef', ref: 'feat/pr-ingest-test' },
    labels: [{ name: 'geo-experiment' }],
  },
  repository: { full_name: 'acme/site' },
} as const;

skipIfNoDb('WebhooksService.handleGithubPullRequest', () => {
  let prisma: PrismaClient;
  let svc: WebhooksService;
  let github: GitHubService;
  const cleanupExperimentIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    const fake = new FakePeecTransport();
    const peecService: PeecMcpService = Object.create(PeecMcpService.prototype);
    Object.assign(peecService, {
      client: new PeecClient(fake),
      mode: 'live',
      baseUrl: 'fake://test',
      logger: { warn() {}, log() {}, error() {} },
      requireClient(): PeecClient {
        return (this as { client: PeecClient }).client;
      },
    });
    const experiments = new ExperimentsService(prisma, peecService);
    const power = new PowerAnalysisService(prisma);
    const snapshots = new SnapshotsService(prisma, peecService);
    github = new GitHubService();
    svc = new WebhooksService(prisma, experiments, power, snapshots, github);
  }, TIMEOUT_MS);

  afterAll(async () => {
    if (cleanupExperimentIds.length) {
      await prisma.experiment.deleteMany({ where: { id: { in: cleanupExperimentIds } } });
    }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Ensure no leftover experiment with the same shareSlug.
    await prisma.experiment.deleteMany({ where: { shareSlug: 'pr-ingest-test' } });
  });

  it(
    'parses the PR yaml, creates an experiment, runs power analysis, and posts a PR comment',
    { timeout: TIMEOUT_MS },
    async () => {
      vi.spyOn(github, 'fetchFileFromRef').mockResolvedValue(VALID_YAML);
      const commentSpy = vi.spyOn(github, 'commentOnPr').mockResolvedValue({
        id: 999,
        html_url: 'https://github.com/acme/site/pull/42#issuecomment-999',
      });

      const result = await svc.handleGithubPullRequest(PR_PAYLOAD as never);
      expect(result.action).toBe('opened');
      expect(result.experimentId).toBeTypeOf('string');
      cleanupExperimentIds.push(result.experimentId as string);

      const exp = await prisma.experiment.findUnique({
        where: { id: result.experimentId },
        include: { events: { orderBy: { createdAt: 'asc' } } },
      });
      expect(exp).toBeTruthy();
      expect(exp?.shareSlug).toBe('pr-ingest-test');
      expect(exp?.githubPrUrl).toBe('https://github.com/acme/site/pull/42');
      expect(exp?.githubPrSha).toBe('deadbeefdeadbeef');
      expect(exp?.status).toBe('DRAFT');

      const types = exp?.events.map((e) => e.type) ?? [];
      expect(types).toContain('CREATED');
      expect(types).toContain('PEEC_TOPIC_CREATED');
      expect(types).toContain('PEEC_TAG_CREATED');
      expect(types).toContain('POWER_ANALYZED');
      expect(types).toContain('PR_COMMENTED');

      // Verify the PR comment body is informative.
      expect(commentSpy).toHaveBeenCalledOnce();
      const callArgs = commentSpy.mock.calls[0]?.[0];
      expect(callArgs?.owner).toBe('acme');
      expect(callArgs?.repo).toBe('site');
      expect(callArgs?.prNumber).toBe(42);
      expect(callArgs?.body).toMatch(/Peec Experiment Lab/);
      expect(callArgs?.body).toMatch(/Smoke test from a fake PR/);
      expect(callArgs?.body).toMatch(/Power analysis/);
    },
  );

  it(
    'comments validation errors when experiment.yaml is invalid',
    { timeout: TIMEOUT_MS },
    async () => {
      vi.spyOn(github, 'fetchFileFromRef').mockResolvedValue('id: BAD UPPERCASE\n');
      const commentSpy = vi.spyOn(github, 'commentOnPr').mockResolvedValue({
        id: 1,
        html_url: 'x',
      });
      const result = await svc.handleGithubPullRequest(PR_PAYLOAD as never);
      expect(result.error).toBeTruthy();
      expect(commentSpy).toHaveBeenCalledOnce();
      expect(commentSpy.mock.calls[0]?.[0].body).toMatch(/failed validation/);
    },
  );

  it(
    'skips PRs without the geo-experiment label',
    { timeout: TIMEOUT_MS },
    async () => {
      const result = await svc.handleGithubPullRequest({
        ...PR_PAYLOAD,
        pull_request: { ...PR_PAYLOAD.pull_request, labels: [{ name: 'docs' }] },
      } as never);
      expect(result.skipped).toMatch(/not labelled/);
    },
  );

  it(
    'skips when experiment.yaml is missing from the PR head',
    { timeout: TIMEOUT_MS },
    async () => {
      vi.spyOn(github, 'fetchFileFromRef').mockResolvedValue(null);
      const result = await svc.handleGithubPullRequest(PR_PAYLOAD as never);
      expect(result.skipped).toMatch(/not present/);
    },
  );

  it(
    'transitions DRAFT → SCHEDULED on closed{merged}',
    { timeout: TIMEOUT_MS },
    async () => {
      // First open the PR to seed a DRAFT experiment.
      vi.spyOn(github, 'fetchFileFromRef').mockResolvedValue(VALID_YAML);
      vi.spyOn(github, 'commentOnPr').mockResolvedValue({ id: 1, html_url: 'x' });
      const opened = await svc.handleGithubPullRequest(PR_PAYLOAD as never);
      cleanupExperimentIds.push(opened.experimentId as string);

      const merged = await svc.handleGithubPullRequest({
        action: 'closed',
        pull_request: { ...PR_PAYLOAD.pull_request, merged: true },
        repository: PR_PAYLOAD.repository,
      } as never);
      expect(merged.experimentId).toBe(opened.experimentId);

      const exp = await prisma.experiment.findUnique({
        where: { id: opened.experimentId as string },
      });
      expect(exp?.status).toBe('SCHEDULED');
    },
  );
});
