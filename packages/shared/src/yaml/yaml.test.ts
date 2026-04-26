import { describe, expect, it } from 'vitest';
import { parseExperimentYaml, parseExperimentYamlOrThrow } from './index.js';

const VALID = `
id: best-crm-rewrite-2026-04
name: "Rewrite /best-crm-for-startups with FAQ + comparison table"
hypothesis: "Adding an FAQ block + comparison table will lift visibility on Perplexity by 5pp."
treatment_url: https://example.com/best-crm-for-startups
treatment_prompts:
  - prompt_id: peec_pr_a1b2c3
  - prompt_id: peec_pr_d4e5f6
control_prompts:
  - prompt_id: peec_pr_g7h8i9
  - prompt_id: peec_pr_j0k1l2
engines: [perplexity, chatgpt, gemini]
min_lift_pp: 5
duration_days: auto
share: public
`;

describe('parseExperimentYaml', () => {
  it('parses the canonical example from PLAN.md §9', () => {
    const r = parseExperimentYaml(VALID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.id).toBe('best-crm-rewrite-2026-04');
    expect(r.data.treatment_prompts).toHaveLength(2);
    expect(r.data.engines).toEqual(['perplexity', 'chatgpt', 'gemini']);
    expect(r.data.duration_days).toBe('auto');
    expect(r.data.share).toBe('public');
  });

  it('defaults engines, duration_days, and share when omitted', () => {
    const min = `
id: smoke-test
name: minimal
hypothesis: "the smallest possible YAML still parses"
treatment_url: https://example.com/x
treatment_prompts:
  - prompt_id: a
control_prompts:
  - prompt_id: b
min_lift_pp: 3
`;
    const r = parseExperimentYaml(min);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.engines).toEqual([]);
    expect(r.data.duration_days).toBe('auto');
    expect(r.data.share).toBe('private');
  });

  it('rejects an id with uppercase characters', () => {
    const bad = VALID.replace('best-crm-rewrite-2026-04', 'Best-CRM');
    const r = parseExperimentYaml(bad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.path === 'id')).toBe(true);
  });

  it('rejects when a prompt is in both arms', () => {
    const bad = VALID.replace('peec_pr_g7h8i9', 'peec_pr_a1b2c3');
    const r = parseExperimentYaml(bad);
    expect(r.ok).toBe(false);
  });

  it('rejects min_lift_pp <= 0', () => {
    const bad = VALID.replace('min_lift_pp: 5', 'min_lift_pp: 0');
    const r = parseExperimentYaml(bad);
    expect(r.ok).toBe(false);
  });

  it('rejects duration_days outside 3-28', () => {
    const bad = VALID.replace('duration_days: auto', 'duration_days: 60');
    const r = parseExperimentYaml(bad);
    expect(r.ok).toBe(false);
  });

  it('throws via parseExperimentYamlOrThrow on bad input', () => {
    expect(() => parseExperimentYamlOrThrow('not: yaml: at: all: :')).toThrow();
  });

  it('rejects empty/null YAML', () => {
    expect(parseExperimentYaml('').ok).toBe(false);
    expect(parseExperimentYaml('null').ok).toBe(false);
  });

  it('rejects unknown top-level fields (strict)', () => {
    const bad = VALID + '\nrogue_field: hello\n';
    const r = parseExperimentYaml(bad);
    expect(r.ok).toBe(false);
  });
});
