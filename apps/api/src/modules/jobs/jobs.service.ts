import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PrismaClient } from '@peec-lab/database';
import { PRISMA } from '../../prisma/prisma.module.js';
import { SnapshotsService } from '../snapshots/snapshots.service.js';
import { AnalysisService } from '../analysis/analysis.service.js';
import { ReportBuilderService } from '../analysis/report-builder.service.js';
import { ExperimentsService } from '../experiments/experiments.service.js';
import { VerdictNotifierService } from './verdict-notifier.service.js';

/**
 * The two cron handlers (PLAN.md §5.6) operate as fan-out + return: they
 * enumerate due experiments and enqueue work into a Vercel Workflow.
 *
 * For local dev / hackathon ergonomics we inline the work here too. In
 * production each `runOne*` would be the body of a Workflow step.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly snapshots: SnapshotsService,
    private readonly analysis: AnalysisService,
    private readonly reports: ReportBuilderService,
    private readonly experiments: ExperimentsService,
    private readonly notifier: VerdictNotifierService,
  ) {}

  async runDailySnapshots() {
    const due = await this.prisma.experiment.findMany({
      where: { status: 'RUNNING' },
      select: { id: true },
    });
    this.logger.log(`Daily snapshots: ${due.length} running experiments`);
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const { id } of due) {
      try {
        await this.snapshots.captureFor(id, 'DAILY');
        await this.prisma.experimentEvent.create({
          data: { experimentId: id, type: 'SNAPSHOTTED', payload: {} },
        });
        results.push({ id, ok: true });
      } catch (err) {
        this.logger.error(`Snapshot for ${id} failed: ${(err as Error).message}`);
        results.push({ id, ok: false, error: (err as Error).message });
      }
    }
    return { processed: due.length, results };
  }

  async runFinalizeDue() {
    const now = new Date();
    const due = await this.prisma.experiment.findMany({
      where: { status: 'RUNNING', endsAt: { lte: now } },
      select: { id: true },
    });
    this.logger.log(`Finalize due: ${due.length} experiments past their endsAt`);
    const results: Array<{ id: string; verdict?: string; ok: boolean; error?: string }> = [];
    for (const { id } of due) {
      try {
        await this.experiments.transition(id, 'RUNNING', 'ANALYZING', 'SNAPSHOTTED', {});
        const v = await this.analysis.computeVerdict(id);
        const r = await this.reports.build(id, v);
        await this.prisma.experimentResult.upsert({
          where: { experimentId: id },
          create: {
            experimentId: id,
            liftByEngine: v.liftByEngine as object,
            verdict: v.verdict,
            overallPValue: v.overallPValue,
            reportMarkdown: r.markdown,
            recommendations: r.recommendations as object,
            evidenceChats: r.evidenceChats as object,
            competitorMovement: r.competitorMovement as object,
          },
          update: {
            liftByEngine: v.liftByEngine as object,
            verdict: v.verdict,
            overallPValue: v.overallPValue,
            reportMarkdown: r.markdown,
            recommendations: r.recommendations as object,
            evidenceChats: r.evidenceChats as object,
            competitorMovement: r.competitorMovement as object,
          },
        });
        await this.experiments.transition(id, 'ANALYZING', v.verdict, 'RESULT_COMPUTED', {
          overallPValue: v.overallPValue,
        });
        // Best-effort outbound notifications (Linear ticket + PR comment).
        // Failures here must NOT roll back the persisted result.
        await this.notifier.notify(id).catch((err) =>
          this.logger.warn(`Verdict notify failed for ${id}: ${(err as Error).message}`),
        );
        results.push({ id, verdict: v.verdict, ok: true });
      } catch (err) {
        this.logger.error(`Finalize ${id} failed: ${(err as Error).message}`);
        results.push({ id, ok: false, error: (err as Error).message });
      }
    }
    return { processed: due.length, results };
  }
}
