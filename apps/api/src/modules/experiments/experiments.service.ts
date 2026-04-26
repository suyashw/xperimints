import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  EventType,
  ExperimentStatus,
  Prisma,
  PrismaClient,
} from '@peec-lab/database';
import { canTransition, type ExperimentYaml } from '@peec-lab/shared';
import { PRISMA } from '../../prisma/prisma.module.js';
import { PeecMcpService } from '../peec/peec-mcp.service.js';

interface CreateExperimentInput {
  organizationId: string;
  peecProjectId: string;
  name: string;
  hypothesis: string;
  treatmentUrl: string;
  treatmentPromptIds: string[];
  controlPromptIds: string[];
  engineIds?: string[];
  minLiftPp: number;
  durationDays?: number;
  randomSeed?: number;
  shareSlug?: string;
  isPublic?: boolean;
  createdById?: string;
  githubPrUrl?: string;
  githubPrSha?: string;
}

@Injectable()
export class ExperimentsService {
  private readonly logger = new Logger(ExperimentsService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly peec: PeecMcpService,
  ) {}

  async list(organizationId: string, filter?: { status?: ExperimentStatus }) {
    return this.prisma.experiment.findMany({
      where: { organizationId, ...(filter?.status ? { status: filter.status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { result: true },
    });
  }

  async getById(organizationId: string, id: string) {
    const exp = await this.prisma.experiment.findFirst({
      where: { id, organizationId },
      include: {
        result: true,
        snapshots: { orderBy: { capturedAt: 'asc' } },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!exp) throw new NotFoundException('Experiment not found');
    return exp;
  }

  async getBySharedSlug(slug: string) {
    return this.prisma.experiment.findFirst({
      where: { shareSlug: slug, isPublic: true },
      include: { result: true, peecProject: true },
    });
  }

  async create(input: CreateExperimentInput) {
    if (input.minLiftPp <= 0 || input.minLiftPp > 100) {
      throw new BadRequestException('minLiftPp must be in (0, 100]');
    }
    if (input.treatmentPromptIds.length === 0 || input.controlPromptIds.length === 0) {
      throw new BadRequestException('Both treatment and control prompt sets must be non-empty');
    }
    const overlap = input.treatmentPromptIds.filter((id) =>
      input.controlPromptIds.includes(id),
    );
    if (overlap.length > 0) {
      throw new BadRequestException(
        `Prompt(s) appear in both arms: ${overlap.join(', ')}`,
      );
    }

    const slug = input.shareSlug ?? cryptoRandomSlug();
    const existing = await this.prisma.experiment.findUnique({ where: { shareSlug: slug } });
    if (existing) throw new ConflictException(`Share slug already used: ${slug}`);

    const created = await this.prisma.experiment.create({
      data: {
        organizationId: input.organizationId,
        peecProjectId: input.peecProjectId,
        name: input.name,
        hypothesis: input.hypothesis,
        status: 'DRAFT',
        treatmentUrl: input.treatmentUrl,
        treatmentPromptIds: input.treatmentPromptIds,
        controlPromptIds: input.controlPromptIds,
        engineIds: input.engineIds ?? [],
        minLiftPp: input.minLiftPp,
        durationDays: input.durationDays ?? 14,
        randomSeed: input.randomSeed ?? 42,
        shareSlug: slug,
        isPublic: input.isPublic ?? false,
        createdById: input.createdById,
        githubPrUrl: input.githubPrUrl,
        githubPrSha: input.githubPrSha,
        events: { create: { type: 'CREATED', payload: { slug } } },
      },
      include: { events: true },
    });

    // PLAN.md §1.4 + §5.4 rows 18-19: auto-create a topic + tag in Peec for
    // every experiment. This is the "flywheel for Peec itself" — every
    // experiment shows up cleanly grouped inside Peec's own dashboards.
    // Best-effort: failures are logged but do not undo the experiment create.
    await this.attachPeecTopicAndTag(created.id, input.peecProjectId, slug).catch((err) => {
      this.logger.warn(
        `attachPeecTopicAndTag(${created.id}) failed (non-fatal): ${(err as Error).message}`,
      );
    });

    return this.prisma.experiment.findUniqueOrThrow({
      where: { id: created.id },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });
  }

  /**
   * Records a *draft* experiment from a prompt-hypothesis hand-off — the
   * "Implement experiment" CTA on the dashboard's prompt-inspector modal.
   *
   * This is intentionally lighter than `create()`:
   *   - No control-prompt arm yet (the user hasn't picked one).
   *   - Treatment URL is a placeholder until the user fills it in.
   *   - No Peec topic/tag side-effects — nothing's being launched yet,
   *     and we don't want to clutter the connected Peec project with
   *     "stub" topics every time someone window-shops a prompt.
   *
   * Idempotent: returns the existing DRAFT row when one already exists
   * for `(organizationId, promptId)`. That keeps the
   * /experiments/new?prompt_id=… page free to call this on every render
   * without creating duplicate rows on refresh.
   *
   * Throws NotFoundException when the org has no synced Peec project (we
   * need `peecProjectId` for the FK) or when there's no cached
   * hypothesis for the prompt yet (the page-load order normally
   * guarantees one, but we defend in depth).
   */
  async recordDraftFromHypothesis(
    organizationId: string,
    promptId: string,
  ): Promise<{ experiment: Awaited<ReturnType<ExperimentsService['list']>>[number]; created: boolean }> {
    if (!promptId) throw new BadRequestException('promptId is required');

    // Idempotency: any existing experiment for this org with `promptId`
    // already in `treatmentPromptIds` short-circuits. We accept ANY
    // status here (not just DRAFT) so a user who already promoted this
    // prompt to RUNNING doesn't get a fresh stub on every page reload.
    const existing = await this.prisma.experiment.findFirst({
      where: {
        organizationId,
        treatmentPromptIds: { has: promptId },
      },
      include: { result: true },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return { experiment: existing, created: false };

    const project = await this.prisma.peecProject.findFirst({
      where: { organizationId },
      orderBy: { lastSyncedAt: 'desc' },
    });
    if (!project) {
      throw new NotFoundException(
        'No Peec project synced yet — connect Peec from /integrations and re-sync first.',
      );
    }

    const cached = await this.prisma.promptHypothesisCache.findUnique({
      where: { organizationId_promptId: { organizationId, promptId } },
    });
    if (!cached) {
      throw new NotFoundException(
        'No analysis found for this prompt yet — open it from the dashboard first.',
      );
    }
    const hypothesis = (cached.result ?? {}) as Record<string, unknown>;
    const name =
      typeof hypothesis.suggestedExperimentName === 'string' && hypothesis.suggestedExperimentName.length >= 3
        ? (hypothesis.suggestedExperimentName as string)
        : `Experiment for ${promptId.slice(0, 12)}`;
    const hypothesisText =
      typeof hypothesis.hypothesis === 'string' && hypothesis.hypothesis.length > 0
        ? (hypothesis.hypothesis as string)
        : 'Auto-recorded from prompt inspector — fill in before launching.';
    const minLiftPp =
      typeof hypothesis.recommendedMinLiftPp === 'number' && hypothesis.recommendedMinLiftPp > 0
        ? Math.min(100, Math.max(1, Math.round(hypothesis.recommendedMinLiftPp as number)))
        : 5;
    const weakEngines = Array.isArray(hypothesis.weakEngines)
      ? (hypothesis.weakEngines as string[]).filter((e) => typeof e === 'string')
      : [];

    const slug = cryptoRandomSlug();
    const created = await this.prisma.experiment.create({
      data: {
        organizationId,
        peecProjectId: project.id,
        name: name.slice(0, 160),
        hypothesis: hypothesisText,
        status: 'DRAFT',
        // Placeholder URL — required by the schema but not meaningful
        // until the user picks a real treatment page on /experiments/new.
        treatmentUrl: 'https://example.com/REPLACEME',
        treatmentPromptIds: [promptId],
        controlPromptIds: [],
        engineIds: weakEngines,
        minLiftPp,
        durationDays: 14,
        randomSeed: 42,
        shareSlug: slug,
        isPublic: false,
        events: {
          create: {
            type: 'CREATED',
            payload: {
              source: 'prompt-inspector-handoff',
              promptId,
              slug,
            },
          },
        },
      },
      include: { result: true },
    });

    this.logger.log(
      `Recorded draft experiment ${created.id} from prompt-inspector hand-off (org=${organizationId}, prompt=${promptId})`,
    );
    return { experiment: created, created: true };
  }

  private async attachPeecTopicAndTag(
    experimentId: string,
    peecProjectIdInternal: string,
    slug: string,
  ): Promise<void> {
    const proj = await this.prisma.peecProject.findUnique({
      where: { id: peecProjectIdInternal },
      select: { peecProjectId: true },
    });
    if (!proj) return;
    // Topic + tag names are scoped + length-capped (Peec maxes at 64).
    const name = truncate(`experiment:${slug}`, 64);

    let peecTopicId: string | null = null;
    let peecTagId: string | null = null;

    const peecClient = await this.peec.getClient();
    if (!peecClient) {
      this.logger.warn(
        `Peec MCP disconnected — skipping create_topic/create_tag for experiment ${experimentId}`,
      );
      return;
    }

    try {
      const t = await peecClient.createTopic({
        project_id: proj.peecProjectId,
        name,
      });
      peecTopicId = pickId(t);
      if (peecTopicId) {
        await this.prisma.experimentEvent.create({
          data: {
            experimentId,
            type: 'PEEC_TOPIC_CREATED',
            payload: { topicId: peecTopicId, name },
          },
        });
      }
    } catch (err) {
      this.logger.warn(`create_topic failed: ${(err as Error).message}`);
    }

    try {
      const tag = await peecClient.createTag({
        project_id: proj.peecProjectId,
        name,
      });
      peecTagId = pickId(tag);
      if (peecTagId) {
        await this.prisma.experimentEvent.create({
          data: {
            experimentId,
            type: 'PEEC_TAG_CREATED',
            payload: { tagId: peecTagId, name },
          },
        });
      }
    } catch (err) {
      this.logger.warn(`create_tag failed: ${(err as Error).message}`);
    }

    if (peecTopicId || peecTagId) {
      await this.prisma.experiment.update({
        where: { id: experimentId },
        data: {
          ...(peecTopicId ? { peecTopicId } : {}),
          ...(peecTagId ? { peecTagId } : {}),
        },
      });
    }
  }

  /**
   * Translate a parsed experiment.yaml + Peec project context into the
   * shape required by `create()`. Used by the GitHub webhook.
   */
  async createFromYaml(args: {
    organizationId: string;
    peecProjectId: string;
    yaml: ExperimentYaml;
    githubPrUrl?: string;
    githubPrSha?: string;
    createdById?: string;
  }) {
    const { yaml } = args;
    return this.create({
      organizationId: args.organizationId,
      peecProjectId: args.peecProjectId,
      name: yaml.name,
      hypothesis: yaml.hypothesis,
      treatmentUrl: yaml.treatment_url,
      treatmentPromptIds: yaml.treatment_prompts.map((p) => p.prompt_id),
      controlPromptIds: yaml.control_prompts.map((p) => p.prompt_id),
      engineIds: yaml.engines as string[],
      minLiftPp: yaml.min_lift_pp,
      durationDays: yaml.duration_days === 'auto' ? 14 : yaml.duration_days,
      shareSlug: yaml.id,
      isPublic: yaml.share === 'public',
      randomSeed: yaml.seed,
      githubPrUrl: args.githubPrUrl,
      githubPrSha: args.githubPrSha,
      createdById: args.createdById,
    });
  }

  /**
   * The ONLY code path that mutates Experiment.status. Validates the transition
   * against the state machine in @peec-lab/shared and writes an ExperimentEvent
   * inside the same transaction.
   */
  async transition(
    id: string,
    expectedFrom: ExperimentStatus,
    to: ExperimentStatus,
    eventType: EventType,
    payload: Prisma.InputJsonValue = {},
  ) {
    if (!canTransition(expectedFrom, to)) {
      throw new BadRequestException(
        `Illegal state transition ${expectedFrom} → ${to}. See enums.ts ALLOWED_TRANSITIONS.`,
      );
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.experiment.updateMany({
        where: { id, status: expectedFrom },
        data: { status: to },
      });
      if (updated.count !== 1) {
        const cur = await tx.experiment.findUnique({
          where: { id },
          select: { status: true },
        });
        throw new ConflictException(
          `Optimistic transition failed: expected ${expectedFrom} but found ${cur?.status ?? 'NULL'}`,
        );
      }
      return tx.experimentEvent.create({
        data: { experimentId: id, type: eventType, payload },
      });
    });
    this.logger.log(`Experiment ${id}: ${expectedFrom} → ${to} (${eventType})`);
    return result;
  }

  async cancel(organizationId: string, id: string) {
    const exp = await this.getById(organizationId, id);
    const cancellableFrom: ExperimentStatus[] = ['DRAFT', 'SCHEDULED', 'RUNNING', 'ANALYZING'];
    if (!cancellableFrom.includes(exp.status)) {
      throw new BadRequestException(`Cannot cancel from terminal status ${exp.status}`);
    }
    await this.transition(id, exp.status, 'CANCELLED', 'ERROR', {
      reason: 'user-cancelled',
    });
    // Best-effort Peec cleanup — fire-and-forget; failures don't undo the cancel.
    if (exp.peecTopicId || exp.peecTagId) {
      const proj = await this.prisma.peecProject.findUnique({
        where: { id: exp.peecProjectId },
        select: { peecProjectId: true },
      });
      const peecClient = await this.peec.getClient();
      if (proj && peecClient) {
        Promise.all([
          exp.peecTopicId
            ? peecClient
                .deleteTopic({ project_id: proj.peecProjectId, topic_id: exp.peecTopicId })
                .catch((e) => this.logger.warn(`delete_topic failed: ${(e as Error).message}`))
            : Promise.resolve(),
          exp.peecTagId
            ? peecClient
                .deleteTag({ project_id: proj.peecProjectId, tag_id: exp.peecTagId })
                .catch((e) => this.logger.warn(`delete_tag failed: ${(e as Error).message}`))
            : Promise.resolve(),
        ]).catch(() => {});
      }
    }
    return this.getById(organizationId, id);
  }
}

function cryptoRandomSlug(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `exp-${t}-${r}`;
}

/**
 * Peec's create_* tools return one of `{id}`, `{topic_id}`, `{tag_id}`,
 * `{brand_id}`, or `{prompt_id}`. Pick the one that's present.
 */
function pickId(resp: unknown): string | null {
  if (!resp || typeof resp !== 'object') return null;
  const r = resp as Record<string, unknown>;
  for (const k of ['id', 'topic_id', 'tag_id', 'brand_id', 'prompt_id']) {
    const v = r[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}
