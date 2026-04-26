/**
 * Integration test for ExperimentsService.create() auto-attaching a Peec topic
 * and tag (PLAN.md §1.4 + §5.4 rows 18-19).
 *
 * Hits the live Neon DB (read DATABASE_URL from .env) and uses the
 * FakePeecTransport so we don't depend on a Peec PAT. Skipped automatically if
 * DATABASE_URL is not set.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@peec-lab/database';
import { FakePeecTransport, PeecClient } from '@peec-lab/mcp-clients';
import { ExperimentsService } from './experiments.service.js';
import { PeecMcpService } from '../peec/peec-mcp.service.js';

const skipIfNoDb = !process.env.DATABASE_URL ? describe.skip : describe;

// Neon cold start + multi-write transactions can take a few seconds.
const TIMEOUT_MS = 30_000;

skipIfNoDb('ExperimentsService.create() — Peec topic/tag auto-attach', () => {
  let prisma: PrismaClient;
  let fakeTransport: FakePeecTransport;
  let service: ExperimentsService;
  let orgId: string;
  let peecProjectId: string;
  const createdIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect(); // warm Neon
    fakeTransport = new FakePeecTransport();
    const peecService: PeecMcpService = Object.create(PeecMcpService.prototype);
    Object.assign(peecService, {
      client: new PeecClient(fakeTransport),
      mode: 'live',
      baseUrl: 'fake://test',
      logger: { warn() {}, log() {}, error() {} },
      requireClient(): PeecClient {
        return (this as { client: PeecClient }).client;
      },
    });
    service = new ExperimentsService(prisma, peecService);

    // The integration test piggybacks on whatever org + Peec project the
    // running dev installation has — sign up once via /signup and connect
    // Peec, then `pnpm test` here can latch onto that data.
    const proj = await prisma.peecProject.findFirst({
      orderBy: { lastSyncedAt: 'desc' },
    });
    if (!proj) {
      throw new Error(
        'No PeecProject in the database. Sign up at /signup, connect Peec, and refresh once before running this test.',
      );
    }
    orgId = proj.organizationId;
    peecProjectId = proj.id;
  }, TIMEOUT_MS);

  afterAll(async () => {
    if (createdIds.length > 0) {
      await prisma.experiment.deleteMany({ where: { id: { in: createdIds } } });
    }
    await prisma.$disconnect();
  });

  it(
    'calls create_topic + create_tag and stamps peecTopicId/peecTagId on the experiment',
    { timeout: TIMEOUT_MS },
    async () => {
    const slug = `topic-tag-auto-${Date.now()}`;
    const exp = await service.create({
      organizationId: orgId,
      peecProjectId,
      name: 'Topic/tag auto-attach test',
      hypothesis: 'create_topic and create_tag are invoked exactly once each.',
      treatmentUrl: 'https://example.com/test',
      treatmentPromptIds: ['prm_t1'],
      controlPromptIds: ['prm_c1'],
      minLiftPp: 5,
      shareSlug: slug,
    });
    createdIds.push(exp.id);

    expect(exp.peecTopicId).toBe('topic_new');
    expect(exp.peecTagId).toBe('tag_new');

    const calls = fakeTransport.calls.map((c) => c.name);
    expect(calls).toContain('create_topic');
    expect(calls).toContain('create_tag');

    const topicCall = fakeTransport.calls.find((c) => c.name === 'create_topic');
    expect(topicCall?.args).toMatchObject({
      project_id: 'demo_proj_1',
      name: `experiment:${slug}`,
    });

    const events = await prisma.experimentEvent.findMany({
      where: { experimentId: exp.id },
      orderBy: { createdAt: 'asc' },
    });
    const types = events.map((e) => e.type);
    expect(types).toContain('CREATED');
    expect(types).toContain('PEEC_TOPIC_CREATED');
    expect(types).toContain('PEEC_TAG_CREATED');
    },
  );

  it(
    'does not blow up when create_topic fails — experiment is still created',
    { timeout: TIMEOUT_MS },
    async () => {
    fakeTransport.reset();
    fakeTransport.on('create_topic', () => {
      throw new Error('simulated Peec outage');
    });
    fakeTransport.on('create_tag', () => ({ id: 'tag_only' }));
    const slug = `topic-failure-${Date.now()}`;
    const exp = await service.create({
      organizationId: orgId,
      peecProjectId,
      name: 'Topic-failure resilience test',
      hypothesis: 'experiment is created even when create_topic throws.',
      treatmentUrl: 'https://example.com/test',
      treatmentPromptIds: ['prm_t1'],
      controlPromptIds: ['prm_c1'],
      minLiftPp: 5,
      shareSlug: slug,
    });
    createdIds.push(exp.id);
    expect(exp).toBeDefined();
    expect(exp.peecTopicId).toBeNull();
    expect(exp.peecTagId).toBe('tag_only');
    },
  );
});
