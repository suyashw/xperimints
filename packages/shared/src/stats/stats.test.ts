import { describe, expect, it } from 'vitest';
import { bonferroni, permutationTest } from './permutation.js';
import { estimatePower } from './power.js';
import { mean, mulberry32, shuffleInPlace, variance } from './random.js';
import type { Observation } from './permutation.js';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBeCloseTo(b(), 12);
    }
  });

  it('produces values in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('shuffleInPlace', () => {
  it('preserves the multiset', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const before = [...arr].sort((a, b) => a - b);
    shuffleInPlace(arr, mulberry32(99));
    expect([...arr].sort((a, b) => a - b)).toEqual(before);
  });
});

describe('mean / variance', () => {
  it('computes correct sample stats', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
    expect(variance([1, 2, 3, 4, 5])).toBeCloseTo(2.5, 6);
  });
  it('returns 0 for empty / single-element arrays', () => {
    expect(mean([])).toBe(0);
    expect(variance([5])).toBe(0);
  });
});

describe('permutationTest', () => {
  it('reports a small p-value when treatment clearly beats control', () => {
    const obs: Observation[] = [
      ...new Array(20).fill(0).map(() => ({ arm: 'control' as const, value: 0.2 })),
      ...new Array(20).fill(0).map(() => ({ arm: 'treatment' as const, value: 0.6 })),
    ];
    const r = permutationTest(obs, { permutations: 2000, seed: 42 });
    expect(r.observedDelta).toBeCloseTo(0.4, 6);
    expect(r.pValue).toBeLessThan(0.01);
  });

  it('reports a large p-value when arms are statistically identical', () => {
    const rng = mulberry32(7);
    const obs: Observation[] = [];
    // Interleave arm draws from the *same* PRNG so neither arm gets a biased
    // contiguous slice of the sequence.
    for (let i = 0; i < 120; i++) {
      obs.push({ arm: i % 2 === 0 ? 'control' : 'treatment', value: rng() });
    }
    const r = permutationTest(obs, { permutations: 2000, seed: 42 });
    expect(r.pValue).toBeGreaterThan(0.05);
  });

  it('returns identical p-values for the same seed (reproducibility)', () => {
    const obs: Observation[] = [
      { arm: 'control', value: 0.1 },
      { arm: 'control', value: 0.2 },
      { arm: 'control', value: 0.15 },
      { arm: 'treatment', value: 0.4 },
      { arm: 'treatment', value: 0.35 },
      { arm: 'treatment', value: 0.42 },
    ];
    const a = permutationTest(obs, { permutations: 1000, seed: 7 });
    const b = permutationTest(obs, { permutations: 1000, seed: 7 });
    expect(a.pValue).toBe(b.pValue);
    expect(a.observedDelta).toBe(b.observedDelta);
  });

  it('handles zero-sized arms gracefully (returns p=1)', () => {
    const r = permutationTest([{ arm: 'control', value: 0.1 }], { permutations: 500 });
    expect(r.pValue).toBe(1);
  });

  it('CI brackets the observed delta', () => {
    const rng = mulberry32(99);
    const obs: Observation[] = [];
    for (let i = 0; i < 30; i++) obs.push({ arm: 'control', value: 0.3 + 0.05 * rng() });
    for (let i = 0; i < 30; i++) obs.push({ arm: 'treatment', value: 0.5 + 0.05 * rng() });
    const r = permutationTest(obs, { permutations: 1500, seed: 11 });
    expect(r.ci95.low).toBeLessThanOrEqual(r.observedDelta);
    expect(r.ci95.high).toBeGreaterThanOrEqual(r.observedDelta);
  });
});

describe('bonferroni', () => {
  it('multiplies by the number of comparisons, capped at 1', () => {
    expect(bonferroni(0.01, 3)).toBeCloseTo(0.03, 6);
    expect(bonferroni(0.5, 4)).toBe(1);
    expect(bonferroni(0.04, 1)).toBe(0.04);
  });
});

describe('estimatePower', () => {
  it('reports near-zero power when the true effect is tiny', () => {
    const baseline = new Array(30).fill(0).map((_, i) => 0.4 + 0.05 * Math.sin(i));
    const r = estimatePower({
      baseline,
      trueEffect: 0.001,
      perArmSamples: 10,
      iterations: 80,
      permutations: 300,
      seed: 1,
    });
    expect(r.power).toBeLessThan(0.3);
  });

  it('reports high power when the true effect is large vs noise', () => {
    const baseline = new Array(30).fill(0).map((_, i) => 0.4 + 0.005 * Math.sin(i));
    const r = estimatePower({
      baseline,
      trueEffect: 0.2,
      perArmSamples: 30,
      iterations: 80,
      permutations: 300,
      seed: 1,
    });
    expect(r.power).toBeGreaterThan(0.7);
  });
});
