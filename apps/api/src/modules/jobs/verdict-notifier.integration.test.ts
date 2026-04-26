/**
 * Integration test for VerdictNotifierService. Latches onto any completed
 * experiment that already has an ExperimentResult attached. Skipped when
 * the running install hasn't created one yet — the test is opt-in and
 * not part of the default `pnpm test` happy path.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@peec-lab/database';
import { GitHubService } from '../notifications/github.service.js';
import { LinearService } from '../notifications/linear.service.js';
import { VerdictNotifierService } from './verdict-notifier.service.js';

const skipIfNoDb = !process.env.DATABASE_URL ? describe.skip : describe;
const TIMEOUT_MS = 30_000;

skipIfNoDb('VerdictNotifierService.notify', () => {
  let prisma: PrismaClient;
  let github: GitHubService;
  let linear: LinearService;
  let notifier: VerdictNotifierService;
  let seedExperimentId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    github = new GitHubService();
    linear = new LinearService();
    notifier = new VerdictNotifierService(prisma, github, linear);

    const exp = await prisma.experiment.findFirst({
      where: { result: { isNot: null } },
      orderBy: { createdAt: 'desc' },
    });
    if (!exp) {
      throw new Error(
        'No completed experiment with a result — create one in the dashboard before running this integration test.',
      );
    }
    seedExperimentId = exp.id;
  }, TIMEOUT_MS);

  afterAll(async () => {
    // Clean up any LINEAR_TICKET_CREATED / PR_COMMENTED events emitted by tests.
    await prisma.experimentEvent.deleteMany({
      where: {
        experimentId: seedExperimentId,
        type: { in: ['LINEAR_TICKET_CREATED', 'PR_COMMENTED'] },
      },
    });
    await prisma.$disconnect();
  });

  it(
    'no-ops cleanly when GitHub/Linear are disabled (no env vars)',
    { timeout: TIMEOUT_MS },
    async () => {
      vi.spyOn(github, 'enabled').mockReturnValue(false);
      vi.spyOn(linear, 'enabled').mockReturnValue(false);
      const r = await notifier.notify(seedExperimentId);
      expect(r.linearIssueUrl).toBeNull();
      expect(r.prCommentUrl).toBeNull();
    },
  );

  it(
    'posts a PR comment when github is enabled and the experiment has a PR URL',
    { timeout: TIMEOUT_MS },
    async () => {
      // Stamp a PR URL onto the seed experiment for this test.
      await prisma.experiment.update({
        where: { id: seedExperimentId },
        data: { githubPrUrl: 'https://github.com/acme/site/pull/7' },
      });

      vi.spyOn(github, 'enabled').mockReturnValue(true);
      vi.spyOn(linear, 'enabled').mockReturnValue(false);
      const commentSpy = vi.spyOn(github, 'commentOnPr').mockResolvedValue({
        id: 1234,
        html_url: 'https://github.com/acme/site/pull/7#issuecomment-1234',
      });

      const r = await notifier.notify(seedExperimentId);
      expect(r.prCommentUrl).toBe('https://github.com/acme/site/pull/7#issuecomment-1234');
      expect(commentSpy).toHaveBeenCalledOnce();
      const args = commentSpy.mock.calls[0]?.[0];
      expect(args?.owner).toBe('acme');
      expect(args?.repo).toBe('site');
      expect(args?.prNumber).toBe(7);
      expect(args?.body).toMatch(/verdict.*WIN/i);
      expect(args?.body).toMatch(/perplexity-scraper/);
      expect(args?.body).toMatch(/\+6\.\d+pp/);

      // Cleanup the PR URL stamp.
      await prisma.experiment.update({
        where: { id: seedExperimentId },
        data: { githubPrUrl: null },
      });
    },
  );

  it(
    'creates a Linear issue when LINEAR_API_KEY + LINEAR_TEAM_ID are present',
    { timeout: TIMEOUT_MS },
    async () => {
      vi.spyOn(github, 'enabled').mockReturnValue(false);
      vi.spyOn(linear, 'enabled').mockReturnValue(true);
      // Stub the Linear createIssue call.
      const linearSpy = vi.spyOn(linear, 'createIssue').mockResolvedValue({
        id: 'linear-123',
        identifier: 'PEEC-42',
        url: 'https://linear.app/peec/issue/PEEC-42',
        title: 'verdict ticket',
      });
      // Make the env present for this test only.
      const prevTeam = process.env.LINEAR_TEAM_ID;
      process.env.LINEAR_TEAM_ID = 'team_123';
      try {
        const r = await notifier.notify(seedExperimentId);
        expect(r.linearIssueUrl).toBe('https://linear.app/peec/issue/PEEC-42');
        expect(linearSpy).toHaveBeenCalledOnce();
        const arg = linearSpy.mock.calls[0]?.[0];
        expect(arg?.title).toMatch(/Experiment WIN/);
        expect(arg?.title).toMatch(/Add FAQ JSON-LD/);
        expect(arg?.description ?? '').toMatch(/Per-engine lift/);
      } finally {
        if (prevTeam === undefined) delete process.env.LINEAR_TEAM_ID;
        else process.env.LINEAR_TEAM_ID = prevTeam;
      }
    },
  );
});
