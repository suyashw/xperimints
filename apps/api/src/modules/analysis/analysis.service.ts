import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PrismaClient, Verdict } from '@peec-lab/database';
import {
  bonferroni,
  permutationTest,
  type LiftByEngine,
  type Observation,
} from '@peec-lab/shared';
import { PRISMA } from '../../prisma/prisma.module.js';

interface PerEngineSeries {
  treatment: number[];
  control: number[];
}

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /**
   * Compute the verdict for a single experiment.
   *
   *   1. Load every ExperimentSnapshot in chronological order.
   *   2. For each engine the experiment cares about, build two arms of values:
   *        treatment = visibility on treatment_prompts during the experiment window
   *        control   = visibility on control_prompts during the same window
   *   3. Run a permutation test per engine.
   *   4. Bonferroni-correct across engines.
   *   5. Verdict per PLAN.md §5.5:
   *      WIN  → any engine has corrected p < 0.05 AND lift_pp ≥ minLiftPp,
   *             AND no engine has corrected p < 0.05 with lift_pp ≤ -minLiftPp.
   *      LOSS → any engine has corrected p < 0.05 AND lift_pp ≤ -minLiftPp
   *             AND no winning engines.
   *      INCONCLUSIVE → otherwise.
   */
  async computeVerdict(
    experimentId: string,
  ): Promise<{ liftByEngine: LiftByEngine; verdict: Verdict; overallPValue: number }> {
    const exp = await this.prisma.experiment.findUnique({
      where: { id: experimentId },
      include: { snapshots: { orderBy: { capturedAt: 'asc' } } },
    });
    if (!exp) throw new Error(`Experiment ${experimentId} not found`);

    const treatmentSet = new Set(exp.treatmentPromptIds);
    const controlSet = new Set(exp.controlPromptIds);
    const enginesInScope = new Set(exp.engineIds);

    const perEngine = new Map<string, PerEngineSeries>();
    for (const snap of exp.snapshots) {
      const matrix = (snap.brandMetrics ?? {}) as Record<
        string,
        Record<string, Record<string, number> | undefined>
      >;
      for (const [promptId, byEngine] of Object.entries(matrix)) {
        const arm: 'treatment' | 'control' | null = treatmentSet.has(promptId)
          ? 'treatment'
          : controlSet.has(promptId)
            ? 'control'
            : null;
        if (!arm) continue;
        for (const [engineId, cell] of Object.entries(byEngine)) {
          if (enginesInScope.size > 0 && !enginesInScope.has(engineId)) continue;
          const v = cell?.visibility;
          if (typeof v !== 'number' || !Number.isFinite(v)) continue;
          const series = perEngine.get(engineId) ?? { treatment: [], control: [] };
          series[arm].push(v);
          perEngine.set(engineId, series);
        }
      }
    }

    if (perEngine.size === 0) {
      this.logger.warn(`Experiment ${experimentId}: no per-engine data — INCONCLUSIVE`);
      return { liftByEngine: {}, verdict: 'INCONCLUSIVE', overallPValue: 1 };
    }

    const liftByEngine: LiftByEngine = {};
    const minLiftRatio = exp.minLiftPp / 100;
    let bestP = 1;
    let anyWin = false;
    let anyLoss = false;
    const numComparisons = perEngine.size;

    for (const [engineId, series] of perEngine.entries()) {
      const obs: Observation[] = [
        ...series.treatment.map((v) => ({ arm: 'treatment' as const, value: v })),
        ...series.control.map((v) => ({ arm: 'control' as const, value: v })),
      ];
      const r = permutationTest(obs, { permutations: 10_000, seed: exp.randomSeed });
      const pCorrected = bonferroni(r.pValue, numComparisons);
      liftByEngine[engineId] = {
        lift_pp: r.observedDelta * 100,
        ci_low: r.ci95.low * 100,
        ci_high: r.ci95.high * 100,
        p_value: r.pValue,
        p_value_corrected: pCorrected,
        samples_pre: series.control.length,
        samples_post: series.treatment.length,
      };
      bestP = Math.min(bestP, pCorrected);
      if (pCorrected < 0.05 && r.observedDelta >= minLiftRatio) anyWin = true;
      if (pCorrected < 0.05 && r.observedDelta <= -minLiftRatio) anyLoss = true;
    }

    const verdict: Verdict = anyWin && !anyLoss
      ? 'WIN'
      : anyLoss && !anyWin
        ? 'LOSS'
        : 'INCONCLUSIVE';

    return { liftByEngine, verdict, overallPValue: bestP };
  }
}
