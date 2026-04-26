import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import type { ExperimentStatus } from '@peec-lab/database';
import { ExperimentsService } from './experiments.service.js';
import { SnapshotsService } from '../snapshots/snapshots.service.js';

/**
 * For the hackathon we resolve `organizationId` from a trusted header set by
 * the Next.js middleware after Clerk auth (PLAN.md §5.1 AuthModule).
 * In production this would be JWT verification.
 */
const ORG_HEADER = 'x-peec-lab-org';

const createBodySchema = z
  .object({
    peecProjectId: z.string().min(1),
    name: z.string().min(3).max(160),
    hypothesis: z.string().min(10),
    treatmentUrl: z.string().url(),
    treatmentPromptIds: z.array(z.string()).min(1),
    controlPromptIds: z.array(z.string()).min(1),
    engineIds: z.array(z.string()).optional(),
    minLiftPp: z.number().positive().max(100),
    durationDays: z.number().int().min(3).max(28).optional(),
    isPublic: z.boolean().optional(),
    shareSlug: z.string().optional(),
    randomSeed: z.number().int().nonnegative().optional(),
  })
  .strict();

const draftFromPromptSchema = z
  .object({
    promptId: z.string().min(1),
  })
  .strict();

@Controller('experiments')
export class ExperimentsController {
  constructor(
    private readonly service: ExperimentsService,
    private readonly snapshots: SnapshotsService,
  ) {}

  @Get()
  list(
    @Headers(ORG_HEADER) organizationId: string,
    @Query('status') status?: ExperimentStatus,
  ) {
    requireOrg(organizationId);
    return this.service.list(organizationId, { status });
  }

  @Get(':id')
  byId(@Headers(ORG_HEADER) organizationId: string, @Param('id') id: string) {
    requireOrg(organizationId);
    return this.service.getById(organizationId, id);
  }

  @Post()
  create(@Headers(ORG_HEADER) organizationId: string, @Body() body: unknown) {
    requireOrg(organizationId);
    const parsed = createBodySchema.parse(body);
    return this.service.create({ organizationId, ...parsed });
  }

  /**
   * Lightweight "Implement experiment" hand-off from the dashboard
   * prompt-inspector. Idempotent: pass the same promptId on every
   * page reload of /experiments/new and you'll get the same draft
   * back without duplicating rows. See `recordDraftFromHypothesis`
   * in the service for the full contract.
   */
  @Post('draft-from-prompt')
  draftFromPrompt(
    @Headers(ORG_HEADER) organizationId: string,
    @Body() body: unknown,
  ) {
    requireOrg(organizationId);
    const parsed = draftFromPromptSchema.parse(body);
    return this.service.recordDraftFromHypothesis(organizationId, parsed.promptId);
  }

  @Post(':id/cancel')
  cancel(@Headers(ORG_HEADER) organizationId: string, @Param('id') id: string) {
    requireOrg(organizationId);
    return this.service.cancel(organizationId, id);
  }

  /**
   * PLAN.md §5.2 + §6.4: user-triggered Peec refresh that bypasses the
   * once-daily Hobby cron. Captures one DAILY snapshot synchronously and
   * returns it. Cheap (~1 Peec roundtrip) — well under the Hobby 60s ceiling.
   */
  @Post(':id/refresh-now')
  async refreshNow(
    @Headers(ORG_HEADER) organizationId: string,
    @Param('id') id: string,
  ) {
    requireOrg(organizationId);
    const exp = await this.service.getById(organizationId, id);
    if (!['RUNNING', 'SCHEDULED', 'ANALYZING'].includes(exp.status)) {
      throw new BadRequestException(
        `refresh-now only valid for RUNNING / SCHEDULED / ANALYZING (current: ${exp.status})`,
      );
    }
    const snapshot = await this.snapshots.captureFor(id, 'DAILY');
    return {
      ok: true,
      snapshotId: snapshot.id,
      capturedAt: snapshot.capturedAt,
    };
  }
}

function requireOrg(orgId: string | undefined): asserts orgId is string {
  if (!orgId) throw new Error(`Missing ${ORG_HEADER} header`);
}
