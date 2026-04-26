/**
 * Offline tools: pure transforms / pure stats. Don't touch the API or DB,
 * so they work in any context (CI, local dev, judging laptop without
 * connectivity).
 */

import { z } from 'zod';
import { estimatePower, parseExperimentYaml } from '@peec-lab/shared';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerOfflineTools(server: McpServer): void {
  server.registerTool(
    'xperi_validate_yaml',
    {
      title: 'Validate experiment.yaml',
      description:
        'Validate a raw experiment.yaml string against the canonical schema. ' +
        'Returns the parsed experiment on success, or a list of `{ path, message }` ' +
        'errors on failure. Pure / offline — does not touch the API.',
      inputSchema: {
        yaml: z
          .string()
          .min(1)
          .describe('Raw experiment.yaml file contents (the file body, not a path).'),
      },
    },
    async ({ yaml }) => {
      const r = parseExperimentYaml(yaml);
      const payload = r.ok
        ? {
            ok: true as const,
            experiment: r.data,
          }
        : {
            ok: false as const,
            errors: r.errors,
          };
      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      };
    },
  );

  server.registerTool(
    'xperi_power_analysis',
    {
      title: 'Quick power analysis',
      description:
        'Synthetic Monte-Carlo power estimate for a candidate experiment. ' +
        'Sweeps duration_days × engines × prompts and tells you whether ' +
        '`min_lift_pp` is detectable at 80% power. Useful before opening a ' +
        'PR — the same math runs server-side via PowerAnalysisService when ' +
        'the experiment lands. Pure / offline; does not need the API.',
      inputSchema: {
        minLiftPp: z
          .number()
          .positive()
          .max(100)
          .describe('Minimum detectable effect, in percentage points (e.g. 5 = 5pp).'),
        engines: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(3)
          .describe('How many AI engines you plan to measure (chatgpt, perplexity, ...).'),
        prompts: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(2)
          .describe('How many prompts per arm (treatment AND control are the same size).'),
        durations: z
          .array(z.number().int().min(3).max(60))
          .default([7, 10, 14, 21, 28])
          .describe('Candidate durations in days to sweep.'),
      },
    },
    async ({ minLiftPp, engines, prompts, durations }) => {
      const minLift = minLiftPp / 100;
      // Synthetic baseline (mu ≈ 0.4, sigma ≈ 0.05) — calibrated against
      // the typical visibility dispersion we see in seed data. The real
      // PowerAnalysisService uses the user's last-30d snapshots.
      const baseline = new Array(30).fill(0).map((_, i) => 0.4 + 0.05 * Math.sin(i));
      const rows = durations.map((days) => {
        const perArm = days * engines * prompts;
        const r = estimatePower({
          baseline,
          trueEffect: minLift,
          perArmSamples: perArm,
          iterations: 120,
          permutations: 400,
          seed: 1,
        });
        return {
          days,
          perArmSamples: perArm,
          power: Number(r.power.toFixed(3)),
          meets80Power: r.power >= 0.8,
        };
      });
      const recommended = rows.find((r) => r.meets80Power) ?? null;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                minLiftPp,
                engines,
                prompts,
                rows,
                recommendedDurationDays: recommended?.days ?? null,
                note: recommended
                  ? `Run for ≥${recommended.days} days to hit 80% power at ${minLiftPp}pp.`
                  : `At these settings even ${Math.max(...durations)} days does not reach 80% power; reduce min_lift_pp or add prompts.`,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
