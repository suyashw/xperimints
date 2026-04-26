import { mean, mulberry32, variance } from './random.js';
import type { Observation } from './permutation.js';
import { permutationTest } from './permutation.js';

export interface PowerAnalysisInput {
  /**
   * Baseline observations of the metric (e.g. last-30-day per-day visibility for
   * each (prompt, engine) cell pre-experiment). Used to estimate noise.
   */
  baseline: ReadonlyArray<number>;
  /** Effect size we want to detect, in same units as `baseline` (e.g. 0.05 for 5pp). */
  trueEffect: number;
  /** Per-arm sample size to simulate at — e.g. duration_days × engines × prompts/2. */
  perArmSamples: number;
  /** Number of Monte Carlo repetitions. 1000 gives a power estimate ±1.5pp at p=0.5. */
  iterations?: number;
  /** Significance threshold (after any correction the caller wants to apply). */
  alpha?: number;
  permutations?: number;
  seed?: number;
}

export interface PowerAnalysisResult {
  power: number;
  meanDelta: number;
  iterations: number;
  perArmSamples: number;
  trueEffect: number;
}

/**
 * Monte Carlo power estimate. We sample two arms from a normal centred at
 * (baseline_mean) and (baseline_mean + trueEffect) with baseline variance, then
 * run a (small-permutation) permutation test, and count how often we reject H0
 * at the given alpha. Returns the empirical power.
 *
 * Used by PowerAnalysisService to recommend `duration_days`. Per PLAN.md §5.5:
 * if even at the cap (28 days) power < 0.6 we *block* the experiment.
 */
export function estimatePower(input: PowerAnalysisInput): PowerAnalysisResult {
  const {
    baseline,
    trueEffect,
    perArmSamples,
    iterations = 400,
    alpha = 0.05,
    permutations = 1_000, // small inner permutation count is fine for power estimation
    seed = 1,
  } = input;

  if (baseline.length === 0 || perArmSamples <= 0) {
    return { power: 0, meanDelta: 0, iterations: 0, perArmSamples, trueEffect };
  }

  const mu = mean(baseline);
  const sigma = Math.sqrt(Math.max(variance(baseline), 1e-9));
  const rng = mulberry32(seed);

  let rejects = 0;
  let sumDelta = 0;
  for (let i = 0; i < iterations; i++) {
    const obs: Observation[] = new Array(perArmSamples * 2);
    for (let j = 0; j < perArmSamples; j++) {
      obs[j] = { arm: 'control', value: clamp01(mu + sigma * gauss(rng)) };
      obs[j + perArmSamples] = {
        arm: 'treatment',
        value: clamp01(mu + trueEffect + sigma * gauss(rng)),
      };
    }
    const r = permutationTest(obs, { permutations, seed: seed + i });
    sumDelta += r.observedDelta;
    if (r.pValue < alpha) rejects++;
  }
  return {
    power: rejects / iterations,
    meanDelta: sumDelta / iterations,
    iterations,
    perArmSamples,
    trueEffect,
  };
}

/**
 * Box–Muller standard-normal sample. Reuses the supplied PRNG for determinism.
 */
function gauss(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Convenience: search for the smallest `perArmSamples` that achieves at least
 * `targetPower` (e.g. 0.8). Capped at `cap` (typically 28 days × engines × prompts).
 * Returns null if not achievable inside the cap.
 */
export function recommendSampleSize(
  baseSampleSizesAsc: ReadonlyArray<number>,
  baseInput: Omit<PowerAnalysisInput, 'perArmSamples'>,
  targetPower = 0.8,
): { perArmSamples: number; power: number } | null {
  for (const n of baseSampleSizesAsc) {
    const r = estimatePower({ ...baseInput, perArmSamples: n });
    if (r.power >= targetPower) {
      return { perArmSamples: n, power: r.power };
    }
  }
  return null;
}
