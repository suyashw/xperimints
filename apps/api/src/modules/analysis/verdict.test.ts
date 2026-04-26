import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@peec-lab/shared';

/**
 * Sanity check that mirrors the verdict-decision logic in AnalysisService
 * without booting NestJS — fast, deterministic, and tells us when our verdict
 * thresholds drift.
 */

import { bonferroni, permutationTest } from '@peec-lab/shared';

function fakeWinExperiment(seed: number) {
  const rng = mulberry32(seed);
  const treatment = new Array(20).fill(0).map(() => 0.5 + 0.05 * rng());
  const control = new Array(20).fill(0).map(() => 0.3 + 0.05 * rng());
  return { treatment, control };
}

function fakeNoiseExperiment(seed: number) {
  const rng = mulberry32(seed);
  const all = new Array(60).fill(0).map(() => 0.4 + 0.05 * (rng() - 0.5));
  return {
    treatment: all.filter((_, i) => i % 2 === 0),
    control: all.filter((_, i) => i % 2 === 1),
  };
}

describe('verdict pipeline (mirrors AnalysisService logic)', () => {
  it('declares WIN when treatment is meaningfully ahead and lift ≥ minLiftPp', () => {
    const { treatment, control } = fakeWinExperiment(1);
    const r = permutationTest(
      [
        ...treatment.map((v) => ({ arm: 'treatment' as const, value: v })),
        ...control.map((v) => ({ arm: 'control' as const, value: v })),
      ],
      { permutations: 1500, seed: 7 },
    );
    const minLift = 0.05;
    const corrected = bonferroni(r.pValue, 3);
    const isWin = corrected < 0.05 && r.observedDelta >= minLift;
    expect(isWin).toBe(true);
  });

  it('declares INCONCLUSIVE on noise even with small p-value if lift < minLiftPp', () => {
    const { treatment, control } = fakeNoiseExperiment(2);
    const r = permutationTest(
      [
        ...treatment.map((v) => ({ arm: 'treatment' as const, value: v })),
        ...control.map((v) => ({ arm: 'control' as const, value: v })),
      ],
      { permutations: 1500, seed: 11 },
    );
    const minLift = 0.05;
    const corrected = bonferroni(r.pValue, 3);
    const isWin = corrected < 0.05 && r.observedDelta >= minLift;
    expect(isWin).toBe(false);
  });
});
