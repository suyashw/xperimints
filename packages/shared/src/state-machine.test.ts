import { describe, expect, it } from 'vitest';
import { canTransition, EXPERIMENT_STATUSES, TERMINAL_STATUSES } from './enums.js';

describe('experiment state machine', () => {
  it('allows DRAFT → SCHEDULED', () => {
    expect(canTransition('DRAFT', 'SCHEDULED')).toBe(true);
  });

  it('allows SCHEDULED → RUNNING', () => {
    expect(canTransition('SCHEDULED', 'RUNNING')).toBe(true);
  });

  it('allows RUNNING → ANALYZING', () => {
    expect(canTransition('RUNNING', 'ANALYZING')).toBe(true);
  });

  it('allows RUNNING → RUNNING (idempotent daily ticks)', () => {
    expect(canTransition('RUNNING', 'RUNNING')).toBe(true);
  });

  it('allows ANALYZING → WIN | LOSS | INCONCLUSIVE', () => {
    expect(canTransition('ANALYZING', 'WIN')).toBe(true);
    expect(canTransition('ANALYZING', 'LOSS')).toBe(true);
    expect(canTransition('ANALYZING', 'INCONCLUSIVE')).toBe(true);
  });

  it('forbids skipping straight from DRAFT to RUNNING', () => {
    expect(canTransition('DRAFT', 'RUNNING')).toBe(false);
  });

  it('forbids any transition out of a terminal state', () => {
    for (const t of TERMINAL_STATUSES) {
      for (const s of EXPERIMENT_STATUSES) {
        expect(canTransition(t, s)).toBe(false);
      }
    }
  });

  it('allows cancellation from DRAFT, SCHEDULED, RUNNING but not from terminal states', () => {
    expect(canTransition('DRAFT', 'CANCELLED')).toBe(true);
    expect(canTransition('SCHEDULED', 'CANCELLED')).toBe(true);
    expect(canTransition('RUNNING', 'CANCELLED')).toBe(true);
    expect(canTransition('WIN', 'CANCELLED')).toBe(false);
  });
});
