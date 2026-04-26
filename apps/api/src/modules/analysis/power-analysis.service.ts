import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@peec-lab/database';
import { estimatePower } from '@peec-lab/shared';
import { PRISMA } from '../../prisma/prisma.module.js';

interface PowerRecommendation {
  recommendedDays: number | null;
  power: number;
  achievable: boolean;
  block: boolean;
  message: string;
}

/**
 * Wraps the Monte Carlo power estimator from @peec-lab/shared with the
 * experiment-level inputs from the database. Per PLAN.md §5.5: if even at
 * 28 days power < 0.6 we *block* the experiment.
 */
@Injectable()
export class PowerAnalysisService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async estimateForExperiment(experimentId: string): Promise<PowerRecommendation> {
    const exp = await this.prisma.experiment.findUnique({
      where: { id: experimentId },
      include: { snapshots: { orderBy: { capturedAt: 'desc' }, take: 30 } },
    });
    if (!exp) throw new Error(`Experiment ${experimentId} not found`);

    const baseline: number[] = [];
    for (const snap of exp.snapshots) {
      const matrix = (snap.brandMetrics ?? {}) as Record<
        string,
        Record<string, { visibility?: number } | undefined>
      >;
      for (const byEngine of Object.values(matrix)) {
        for (const cell of Object.values(byEngine)) {
          const v = cell?.visibility;
          if (typeof v === 'number' && Number.isFinite(v)) baseline.push(v);
        }
      }
    }
    // If we don't yet have any baseline data, assume modest noise (sigma ≈ 0.05).
    const seedBaseline = baseline.length >= 5 ? baseline : sampleAroundOrDefault(0.4, 0.05, 30);

    const minLiftRatio = exp.minLiftPp / 100;
    const enginesCount = Math.max(1, exp.engineIds.length || 3);
    const promptsPerArm = Math.max(1, exp.treatmentPromptIds.length);

    for (const days of [7, 10, 14, 21, 28]) {
      const perArmSamples = days * enginesCount * promptsPerArm;
      const r = estimatePower({
        baseline: seedBaseline,
        trueEffect: minLiftRatio,
        perArmSamples,
        iterations: 200,
        permutations: 600,
        seed: exp.randomSeed,
      });
      if (r.power >= 0.8) {
        return {
          recommendedDays: days,
          power: r.power,
          achievable: true,
          block: false,
          message: `At your settings, you'll detect ≥${exp.minLiftPp}pp with ${(r.power * 100).toFixed(0)}% power in ${days} days.`,
        };
      }
    }

    // Even at the cap → block if power < 0.6
    const cap = 28;
    const capR = estimatePower({
      baseline: seedBaseline,
      trueEffect: minLiftRatio,
      perArmSamples: cap * enginesCount * promptsPerArm,
      iterations: 200,
      permutations: 600,
      seed: exp.randomSeed,
    });
    return {
      recommendedDays: null,
      power: capR.power,
      achievable: false,
      block: capR.power < 0.6,
      message:
        capR.power < 0.6
          ? `Underpowered: even at ${cap} days, power is only ${(capR.power * 100).toFixed(0)}% for ≥${exp.minLiftPp}pp. Add more prompts, lower min_lift_pp, or extend duration.`
          : `Borderline: ${cap} days achieves ${(capR.power * 100).toFixed(0)}% power. Consider lowering min_lift_pp.`,
    };
  }
}

function sampleAroundOrDefault(mu: number, sigma: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(mu + sigma * (Math.sin(i) + Math.cos(i * 1.7)) * 0.3);
  return out;
}
