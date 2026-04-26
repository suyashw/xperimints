import { mean, mulberry32, quantile, shuffleInPlace } from './random.js';

/**
 * One observation in the experiment time series. `value` is the metric
 * (visibility 0–1), `arm` is whether this point came from the treatment cohort
 * (post-launch, treatment prompts) or control (pre-launch or control prompts).
 */
export interface Observation {
  value: number;
  arm: 'treatment' | 'control';
}

export interface PermutationResult {
  /** Mean(treatment) − Mean(control), in the same units as `value`. */
  observedDelta: number;
  /** Two-sided p-value: fraction of permutations with |delta| ≥ |observed|. */
  pValue: number;
  /** Bootstrap-style 95% CI of the delta from permutation null distribution. */
  ci95: { low: number; high: number };
  permutations: number;
  samples: { treatment: number; control: number };
}

export interface PermutationOptions {
  permutations?: number;
  /** RNG seed for reproducibility. Same seed + same data → same p-value. */
  seed?: number;
}

const DEFAULT_PERMUTATIONS = 10_000;

/**
 * Two-sample permutation test on the difference of means. No assumptions about
 * normality — appropriate for noisy, possibly-skewed visibility distributions.
 *
 * Per PLAN.md §5.5:
 *   p-value = fraction of permutations with |lift| ≥ |observed|.
 *
 * Cost: O(P × N) where P = permutations and N = total samples. For typical
 * experiments (~14 days × ~3 engines × ~5 prompts ≈ 200 points) and the default
 * 10k permutations this runs in well under a second on a single Vercel function.
 */
export function permutationTest(
  observations: ReadonlyArray<Observation>,
  options: PermutationOptions = {},
): PermutationResult {
  const treatmentVals = observations.filter((o) => o.arm === 'treatment').map((o) => o.value);
  const controlVals = observations.filter((o) => o.arm === 'control').map((o) => o.value);
  const nT = treatmentVals.length;
  const nC = controlVals.length;

  if (nT === 0 || nC === 0) {
    return {
      observedDelta: 0,
      pValue: 1,
      ci95: { low: 0, high: 0 },
      permutations: 0,
      samples: { treatment: nT, control: nC },
    };
  }

  const observedDelta = mean(treatmentVals) - mean(controlVals);
  const observedAbs = Math.abs(observedDelta);

  const permutations = options.permutations ?? DEFAULT_PERMUTATIONS;
  const seed = options.seed ?? 42;
  const rng = mulberry32(seed);

  const all = [...treatmentVals, ...controlVals];
  const deltas = new Array<number>(permutations);
  let extreme = 0;
  // Reservoir buffers (avoid GC churn)
  const buf = all.slice();
  for (let i = 0; i < permutations; i++) {
    shuffleInPlace(buf, rng);
    let sumT = 0;
    for (let j = 0; j < nT; j++) sumT += buf[j] as number;
    let sumC = 0;
    for (let j = nT; j < buf.length; j++) sumC += buf[j] as number;
    const d = sumT / nT - sumC / nC;
    deltas[i] = d;
    if (Math.abs(d) >= observedAbs) extreme++;
  }
  // Add-one smoothing (avoids p == 0 which is misleading at finite permutations)
  const pValue = (extreme + 1) / (permutations + 1);
  deltas.sort((a, b) => a - b);
  const ci95 = {
    low: observedDelta - quantile(deltas, 0.975),
    high: observedDelta - quantile(deltas, 0.025),
  };
  return {
    observedDelta,
    pValue,
    ci95,
    permutations,
    samples: { treatment: nT, control: nC },
  };
}

/**
 * Bonferroni multiple-comparisons correction across engines.
 * Returns p_corrected = min(1, p × m).
 */
export function bonferroni(pValue: number, comparisons: number): number {
  if (comparisons <= 1) return pValue;
  return Math.min(1, pValue * comparisons);
}
