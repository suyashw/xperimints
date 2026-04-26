#!/usr/bin/env node
/**
 * peec-lab — a tiny CLI that lets you run Peec MCP experiment workflows
 * from the terminal, Claude Desktop, or n8n. Useful when you want the value
 * of the Experiment Lab without spinning up the full Next.js app.
 *
 * Subcommands:
 *   peec-lab init               → write a starter experiment.yaml in the cwd
 *   peec-lab validate <file>    → lint an experiment.yaml against the schema
 *   peec-lab power <file>       → quick power analysis (no DB required)
 *   peec-lab projects           → list_projects on your Peec account
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  estimatePower,
  parseExperimentYaml,
} from '@peec-lab/shared';
import {
  FakePeecTransport,
  HttpPeecTransport,
  PeecClient,
  decodeRows,
} from '@peec-lab/mcp-clients';

const args = process.argv.slice(2);
const cmd = args[0];

const STARTER_YAML = `id: my-first-experiment
name: "Rewrite /best-crm-for-startups with FAQ + comparison table"
hypothesis: "Adding an FAQ block + comparison table will lift visibility on Perplexity by 5pp."
treatment_url: https://example.com/best-crm-for-startups
treatment_prompts:
  - prompt_id: peec_pr_REPLACEME_1
  - prompt_id: peec_pr_REPLACEME_2
control_prompts:
  - prompt_id: peec_pr_REPLACEME_3
  - prompt_id: peec_pr_REPLACEME_4
engines: [perplexity, chatgpt, gemini]
min_lift_pp: 5
duration_days: auto
share: public
`;

async function main() {
  switch (cmd) {
    case 'init':
      return doInit();
    case 'validate':
      return doValidate(args[1]);
    case 'power':
      return doPower(args[1]);
    case 'projects':
      return doProjects();
    case '--help':
    case '-h':
    case undefined:
      return printHelp();
    default:
      console.error(`Unknown command: ${cmd}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  console.log(`peec-lab — Peec MCP experiment lab CLI

Usage:
  peec-lab init                    # write experiment.yaml in cwd
  peec-lab validate <file>         # lint experiment.yaml against the schema
  peec-lab power <file>            # quick power analysis (offline, no DB)
  peec-lab projects                # list_projects on your Peec account
                                   #   needs PEEC_MCP_TOKEN in env
`);
}

function doInit() {
  const target = resolve(process.cwd(), 'experiment.yaml');
  if (existsSync(target)) {
    console.error('experiment.yaml already exists in cwd. Aborting.');
    process.exit(1);
  }
  writeFileSync(target, STARTER_YAML, 'utf8');
  console.log(`✅ Wrote ${target}`);
  console.log('Replace the prompt_id placeholders, then run: peec-lab validate experiment.yaml');
}

function doValidate(filePath?: string) {
  if (!filePath) {
    console.error('Usage: peec-lab validate <file>');
    process.exit(1);
  }
  const raw = readFileSync(resolve(process.cwd(), filePath), 'utf8');
  const r = parseExperimentYaml(raw);
  if (!r.ok) {
    console.error('❌ Invalid experiment.yaml:');
    for (const err of r.errors) {
      console.error(`  - ${err.path || '(root)'}: ${err.message}`);
    }
    process.exit(1);
  }
  console.log('✅ Valid experiment.yaml');
  console.log(`   id:          ${r.data.id}`);
  console.log(`   treatment:   ${r.data.treatment_prompts.length} prompt(s)`);
  console.log(`   control:     ${r.data.control_prompts.length} prompt(s)`);
  console.log(`   min_lift_pp: ${r.data.min_lift_pp}`);
  console.log(`   share:       ${r.data.share}`);
}

function doPower(filePath?: string) {
  if (!filePath) {
    console.error('Usage: peec-lab power <file>');
    process.exit(1);
  }
  const raw = readFileSync(resolve(process.cwd(), filePath), 'utf8');
  const r = parseExperimentYaml(raw);
  if (!r.ok) {
    console.error('Cannot power-analyze an invalid experiment.yaml');
    process.exit(1);
  }
  const minLift = r.data.min_lift_pp / 100;
  const engines = (r.data.engines as string[]).length || 3;
  const prompts = r.data.treatment_prompts.length;
  // Use a synthetic baseline (mu ≈ 0.4, sigma ≈ 0.05) — it's only an estimate.
  const baseline = new Array(30).fill(0).map((_, i) => 0.4 + 0.05 * Math.sin(i));
  console.log('Quick power estimate (synthetic baseline; real run uses your prompts):\n');
  for (const days of [7, 10, 14, 21, 28]) {
    const perArm = days * engines * prompts;
    const r = estimatePower({
      baseline,
      trueEffect: minLift,
      perArmSamples: perArm,
      iterations: 120,
      permutations: 400,
      seed: 1,
    });
    console.log(
      `  ${String(days).padStart(2)} days × ${engines} engines × ${prompts} prompts = ${String(perArm).padStart(4)} per arm → power ≈ ${(r.power * 100).toFixed(0)}%`,
    );
  }
}

async function doProjects() {
  const token = process.env.PEEC_MCP_TOKEN;
  const baseUrl = process.env.PEEC_MCP_BASE_URL ?? 'https://api.peec.ai/mcp';
  const transport = token
    ? new HttpPeecTransport({ baseUrl, token })
    : new FakePeecTransport();
  if (!token) {
    console.warn('⚠️  PEEC_MCP_TOKEN missing — using FakePeecTransport (canned data).');
  }
  const client = new PeecClient(transport);
  const r = await client.listProjects({});
  const rows = decodeRows<{ id: string; name: string; status: string }>(r);
  for (const row of rows) {
    console.log(`${row.id}\t${row.name}\t${row.status}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
